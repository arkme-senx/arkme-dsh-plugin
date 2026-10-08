import { randomUUID } from 'node:crypto'
import { ArkmePluginError } from './service.js'
import type { FileTransfers } from './file-transfers.js'
import type { TeamAppOperation, TeamSendResult, TeamTimeline } from '../team-app-contract.js'
import { teamTaskActive, teamTaskFiles, type TeamSendInput, type TeamSendTask } from '../team-send-contract.js'
import { teamContentWithAssets } from '../team-send-content.js'

interface Ports {
  currentUser(): Promise<number | undefined>
  files(): FileTransfers
  identify(ref: string, userId: number): Promise<string>
  execute(operation: TeamAppOperation, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
}
const fail = (code: string, message: string) => new ArkmePluginError(`team-${code}`, message, false, 409)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const transient = (error: unknown): boolean => error instanceof ArkmePluginError
  ? error.retryable || ['arkme-network-error', 'arkme-timeout', 'team-dependency_unavailable', 'team-rate_limited', 'team-reply_conflict'].includes(error.code)
  : error instanceof TypeError
const reason = (error: unknown) => error instanceof ArkmePluginError ? error.code.replace(/^team-/, '') : 'network_unavailable'

// Persisted failures from the retired reply-cursor gate are ordinary pending
// sends. Keep their original identity/body and never override cancellation intent.
function recoverLegacyReply(task: TeamSendTask): TeamSendTask {
  if (task.reason !== 'reply_conflict' || task.cancelRequested || ['sent', 'cancelled'].includes(task.state)) return task
  const recovered: TeamSendTask = { ...task, state: task.state === 'failed' ? 'queued' : task.state, reason: 'preparing' }
  delete recovered.error
  return recovered
}

/** Team delivery policy only. FileTransfers owns all bytes, upload checkpoints and disk writes. */
export class TeamSendQueue {
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private epoch = 0
  private draining: Promise<void> | undefined
  private pollDelay = 30_000
  private readonly progress = new Map<string, TeamSendTask['files']>()
  private readonly active = new Map<string, AbortController>()
  constructor(private readonly ports: Ports) {}
  start(): void { this.wake(0) }
  pause(): void {
    ++this.epoch
    for (const controller of this.active.values()) controller.abort()
  }
  dispose(): void { this.closed = true; this.pause(); clearTimeout(this.timer) }
  private wake(delay: number): void {
    if (this.closed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.recover() }, delay)
    this.timer.unref?.()
  }
  private async user(): Promise<number> {
    const user = await this.ports.currentUser()
    if (!user || this.closed) throw fail('account-changed', '请登录原账号后重试')
    return user
  }
  private async guard(user: number, epoch: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.closed || this.epoch !== epoch || await this.ports.currentUser() !== user) throw fail('account-changed', '登录账号已变化')
    signal?.throwIfAborted()
  }
  async enqueue(input: TeamSendInput): Promise<TeamSendTask> {
    const user = await this.user(), epoch = this.epoch
    if (!uuid.test(input.clientUid) || !Number.isSafeInteger(input.expectedReplySeq) || input.expectedReplySeq < 0
      || !input.content || typeof input.content.text_content !== 'string' || input.content.text_content.length > 20_000
      || !Array.isArray(input.fileRefs) || input.fileRefs.length > 9 || new Set(input.fileRefs).size !== input.fileRefs.length
      || input.fileRefs.some(ref => typeof ref !== 'string')
      || JSON.stringify(input.content).length > 128_000) throw fail('invalid_request', '发送内容或附件无效')
    const conversationKey = await this.ports.identify(input.conversationRef, user)
    const files = await Promise.all(input.fileRefs.map(async ref => (await this.ports.files().readLocal(ref)).file))
    await this.guard(user, epoch)
    const inputCopy: TeamSendInput = structuredClone({conversationRef:input.conversationRef,clientUid:input.clientUid,expectedReplySeq:input.expectedReplySeq,content:input.content,fileRefs:input.fileRefs})
    const tasks = await this.ports.files().mutateTeamSends(user, tasks => {
      const prior = tasks.find(task => task.clientUid === input.clientUid)
      if (prior) {
        if (prior.conversationKey !== conversationKey || prior.expectedReplySeq !== input.expectedReplySeq
          || JSON.stringify(prior.content) !== JSON.stringify(input.content) || JSON.stringify(prior.fileRefs) !== JSON.stringify(input.fileRefs)) {
          throw fail('idempotency_conflict', '同一发送请求的内容不一致，请核对发送结果')
        }
        return
      }
      if (tasks.filter(task => !['sent', 'cancelled'].includes(task.state)).length >= 100) throw fail('queue-full', '待发送消息过多，请先处理失败消息')
      const completed = tasks.filter(task => ['sent', 'cancelled'].includes(task.state) && !task.fileRefs.length).slice(0, -100)
      for (const task of completed) tasks.splice(tasks.indexOf(task), 1)
      tasks.push({ ...inputCopy, taskRef: randomUUID(), conversationKey, createdAtMillis: Date.now(), state: 'queued',
        files: teamTaskFiles(files), attempts: 0, nextAttemptAt: 0 })
    })
    this.wake(0)
    return { ...tasks.find(task => task.clientUid === input.clientUid)!, conversationRef: input.conversationRef }
  }
  async list(conversationRef: string): Promise<TeamSendTask[]> {
    const user = await this.user(), key = await this.ports.identify(conversationRef, user)
    return (await this.ports.files().teamSends(user)).map(recoverLegacyReply).filter(task => task.conversationKey === key).map(task => ({ ...task, conversationRef, files: structuredClone(this.progress.get(`${user}:${task.taskRef}`) ?? task.files) }))
  }
  async retry(conversationRef: string, taskRef: string): Promise<TeamSendTask> {
    const user = await this.user(), key = await this.ports.identify(conversationRef, user)
    const lane = `${user}:${key}`
    if (this.active.has(lane)) throw fail('send-busy', '发送处理中，请稍后重试')
    this.active.set(lane, new AbortController())
    try {
      const tasks = await this.ports.files().mutateTeamSends(user, tasks => {
        const task = tasks.find(task => task.taskRef === taskRef && task.conversationKey === key)
        if (!task) throw fail('task-missing', '发送任务不存在')
        if (['sent', 'cancelled'].includes(task.state)) return
        if (!task.cancelRequested && task.state === 'failed' && task.reason !== 'reply_conflict') throw fail(task.reason ?? 'send-rejected', task.error ?? '此发送已被拒绝')
        if (task.reason === 'reply_conflict') { task.reason = 'preparing'; delete task.error }
        task.state = task.cancelRequested ? 'cancelling' : 'queued'; task.nextAttemptAt = 0
      })
      this.wake(0)
      return { ...tasks.find(task => task.taskRef === taskRef)!, conversationRef }
    } finally { this.active.delete(lane) }
  }
  async cancel(conversationRef: string, taskRef: string): Promise<TeamSendTask> {
    const user = await this.user(), epoch = this.epoch, key = await this.ports.identify(conversationRef, user)
    const lane = `${user}:${key}`
    if (this.active.has(lane)) throw fail('send-busy', '发送处理中，请稍后重试')
    const controller = new AbortController(); this.active.set(lane, controller)
    try {
      const task = (await this.ports.files().teamSends(user)).find(task => task.taskRef === taskRef && task.conversationKey === key)
      if (!task) throw fail('task-missing', '发送任务不存在')
      if (['sent', 'cancelled'].includes(task.state)) return task
      await this.guard(user, epoch, controller.signal)
      // Persist the user's new intent before I/O. Recovery must never send after
      // a cancellation response is lost, including across Host restarts.
      // Older clients do not drain this new state, so a rollback cannot turn
      // an offline cancellation back into an automatic send.
      task.cancelRequested = true; task.state = 'cancelling'; task.nextAttemptAt = 0
      await this.save(user, task)
      try {
        await this.completeCancellation(task, controller.signal)
        await this.guard(user, epoch, controller.signal)
        await this.save(user, task)
      } catch (error) {
        if (!controller.signal.aborted && !this.closed && epoch === this.epoch) {
          await this.guard(user, epoch)
          this.failed(task, error)
          await this.save(user, task)
        }
        throw error
      }
      return { ...task, conversationRef }
    } finally { this.active.delete(lane); this.wake(0) }
  }
  private async completeCancellation(task: TeamSendTask, signal: AbortSignal): Promise<void> {
    if (task.sendContent || task.message) {
      const result = await this.ports.execute('team.app.cancel', {
        conversationRef: task.conversationRef, clientUid: task.clientUid,
      }, signal) as TeamSendResult
      if (!result?.message || !['published', 'cancelled'].includes(result.message.state)) {
        throw fail('cancel-uncertain', '取消结果待确认，请稍后重试')
      }
      task.message = result.message
    }
    task.state = task.message?.state === 'published' ? 'sent' : 'cancelled'
    task.completedAtMillis = Date.now()
    delete task.error; delete task.reason
  }
  private command(task: TeamSendTask): Record<string, unknown> {
    return { conversationRef: task.conversationRef, clientUid: task.clientUid,
      expectedReplySeq: task.expectedReplySeq, content: task.sendContent ?? task.content }
  }
  private async save(user: number, task: TeamSendTask): Promise<void> {
    await this.ports.files().mutateTeamSends(user, tasks => {
      const index = tasks.findIndex(item => item.taskRef === task.taskRef)
      if (index < 0) throw fail('task-missing', '发送任务不存在')
      tasks[index] = structuredClone(task)
    })
  }
  async recover(): Promise<void> {
    if (this.closed) return
    if (this.draining) return this.draining
    const work = this.drain().catch(() => undefined).finally(() => {
      this.draining = undefined
      this.wake(this.pollDelay)
    })
    this.draining = work
    return work
  }
  private async drain(): Promise<void> {
    const user = await this.user(), epoch = this.epoch
    const tasks = (await this.ports.files().teamSends(user)).map(recoverLegacyReply)
    this.pollDelay = tasks.some(teamTaskActive) ? 2_000 : 30_000
    const lanes = new Set<string>()
    const ready = tasks.filter(task => {
      if (['sent', 'cancelled'].includes(task.state)) return false
      if (lanes.has(task.conversationKey)) return false
      lanes.add(task.conversationKey)
      return teamTaskActive(task) && task.nextAttemptAt <= Date.now() && !this.active.has(`${user}:${task.conversationKey}`)
    }).slice(0, 2)
    await Promise.all(ready.map(task => this.run(user, epoch, task)))
    // Do not add a polling interval between consecutive messages in the same
    // conversation. Only failed network attempts wait for their retry deadline.
    const remaining = (await this.ports.files().teamSends(user)).map(recoverLegacyReply)
    const first = new Map<string, TeamSendTask>()
    for (const task of remaining) {
      if (!['sent', 'cancelled'].includes(task.state) && !first.has(task.conversationKey)) first.set(task.conversationKey, task)
    }
    this.pollDelay = Math.min(30_000, ...[...first.values()]
      .filter(task => teamTaskActive(task) && !this.active.has(`${user}:${task.conversationKey}`))
      .map(task => Math.max(0, task.nextAttemptAt - Date.now())))
  }
  private async run(user: number, epoch: number, task: TeamSendTask): Promise<void> {
    const lane = `${user}:${task.conversationKey}`, controller = new AbortController()
    if (this.active.has(lane)) return
    this.active.set(lane, controller)
    try {
      await this.guard(user, epoch, controller.signal)
      if (task.cancelRequested) {
        await this.completeCancellation(task, controller.signal)
        await this.guard(user, epoch, controller.signal)
        await this.save(user, task)
        return
      }
      const timeline = await this.ports.execute('team.app.timeline', { conversationRef: task.conversationRef, limit: 1 }, controller.signal) as TeamTimeline
      if (!task.sendContent && (!timeline.conversation.channel.enabled || timeline.conversation.blocked)) throw fail(timeline.conversation.blocked ? 'conversation_blocked' : 'channel_paused', '此对话暂时不能发送消息')
      if (!task.sendContent) {
        // Server sequence allocation orders independent messages. Retain the original
        // request for idempotent replay; another member's message never changes it.
        task.state = 'uploading'; await this.save(user, task)
        this.progress.set(`${user}:${task.taskRef}`, task.files)
        const assets = task.fileRefs.length ? await this.ports.files().uploadRefs(task.fileRefs, controller.signal, (ref, value) => {
          const file = task.files.find(file => file.fileRef === ref)
          if (file) file.progress = value
        }) : []
        await this.guard(user, epoch, controller.signal)
        task.files = task.files.map((file, i) => ({ ...file, asset: assets[i]!, progress: { phase: 'ready', sentBytes: file.size, totalBytes: file.size } }))
        task.sendContent = teamContentWithAssets(task.content, assets)
      }
      task.state = 'sending'; await this.save(user, task)
      await this.guard(user, epoch, controller.signal)
      const result = await this.ports.execute('team.app.send', this.command(task), controller.signal) as TeamSendResult
      await this.guard(user, epoch, controller.signal)
      if (result.message) task.message = result.message
      if (result.reason) task.reason = result.reason; else delete task.reason
      if (result.message?.state === 'published') { task.state = 'sent'; delete task.error }
      else if (result.message?.state === 'cancelled') { task.state = 'cancelled'; delete task.error }
      else if (!result.reason || ['preparing', 'network_unavailable', 'dependency_unavailable', 'rate_limited', 'reply_conflict'].includes(result.reason)) { task.state = 'retrying'; task.reason = result.reason ?? 'preparing'; delete task.error; this.backoff(task) }
      else { task.state = 'failed'; task.error = '消息未能发送，请核对后取消或重新编辑' }
      if (task.state === 'sent' || task.state === 'cancelled') task.completedAtMillis = Date.now()
      await this.save(user, task)
    } catch (error) {
      if (controller.signal.aborted || this.closed || epoch !== this.epoch) return
      await this.guard(user, epoch)
      // Preserve an observed ACK even if its disk checkpoint temporarily fails.
      if (task.state === 'sent') { await this.save(user, task); return }
      this.failed(task, error)
      await this.save(user, task)
    } finally { this.active.delete(lane); this.progress.delete(`${user}:${task.taskRef}`) }
  }
  private failed(task: TeamSendTask, error: unknown): void {
    task.reason = reason(error)
    task.error = error instanceof Error ? error.message : '发送失败，请重试'
    task.state = transient(error) ? (task.cancelRequested ? 'cancelling' : 'retrying') : 'failed'
    if (task.state === 'retrying' || task.state === 'cancelling') this.backoff(task)
  }
  private backoff(task: TeamSendTask): void {
    task.attempts += 1
    task.nextAttemptAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(task.attempts, 5))
  }
}
