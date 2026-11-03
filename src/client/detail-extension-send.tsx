import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ArkmeSourceKind, ArkmeSourceMessageExtendResult, ArkmeSourceMessageExtensionContext, ArkmeMessageCopyLinkExtensionItem, ArkmeTimelineItem, ArkmeSelfRoleSnapshot, ArkmeHumanMentionInput, ArkmeBotMentionInput } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { requirePhoneForSocialAction } from './social-action-guard.js'
import { createArkmeSdk } from '../sdk/index.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export interface DetailExtensionSend {
  accountKey: string
  sourceKey: string
  sourceRef: string
  sourceKind?: ArkmeSourceKind | undefined
  rootRecordUid: string
  parent: ArkmeTimelineItem
  messageActionRef: string
  recordUid: string
  relationUid: string
  textContent: string
  textFormat?: 'plain' | 'markdown' | undefined
  humanMentions?: ArkmeHumanMentionInput[] | undefined
  botMentions?: ArkmeBotMentionInput[] | undefined
  fileRefs: string[]
  role?: { userId: number; roleId: string } | undefined
  extension: ArkmeMessageCopyLinkExtensionItem
  state: 'sending' | 'sent' | 'failed' | 'uncertain' | 'checking'
  error?: string | undefined
  result?: ArkmeSourceMessageExtendResult | undefined
}
function currentAccount() {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}

/** One task owns the write and its files, independently of either mounted view. */
export class DetailExtensionSendQueue {
  private tasks = new Map<string, DetailExtensionSend>()
  private controllers = new Map<string, AbortController>()
  private listeners = new Set<() => void>()
  private revision = 0
  private readonly storageKey = 'arkme.detail-extension-sends.v1'
  constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(this.storageKey) ?? '[]')
      if (Array.isArray(saved)) for (const task of saved) {
        if (typeof task?.accountKey !== 'string' || typeof task.sourceKey !== 'string'
          || typeof task.sourceRef !== 'string' || typeof task.recordUid !== 'string'
          || typeof task.messageActionRef !== 'string' || !task.parent?.itemUid || !task.extension?.recordUid
          || !Array.isArray(task.fileRefs)) continue
        this.tasks.set(this.key(task), { ...task, state: task.state === 'sent' ? 'sent' : 'uncertain',
          error: task.state === 'sent' ? undefined : '发送被中断，内容已保留，请核对发送结果' })
      }
    } catch { /* An unavailable journal never supplies message content. */ }
  }
  private key(task: Pick<DetailExtensionSend, 'accountKey' | 'recordUid'>) { return JSON.stringify([task.accountKey, task.recordUid]) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getRevision = () => this.revision
  private publish() {
    this.revision++
    for (const listener of this.listeners) listener()
    try { this.storage?.setItem(this.storageKey, JSON.stringify([...this.tasks.values()])) } catch { /* Retain the in-memory recovery task. */ }
  }
  views(accountKey: string | undefined, sourceKey: string) {
    return [...this.tasks.values()].filter(task => task.accountKey === accountKey && task.sourceKey === sourceKey)
  }
  enqueue(input: Omit<DetailExtensionSend, 'state'>) {
    if (input.accountKey !== currentAccount()) throw new Error('登录账号已变化，请重新发送')
    const key = this.key(input)
    if (this.tasks.has(key)) throw new Error('这条延展正在发送，请勿重复提交')
    const task: DetailExtensionSend = { ...input, state: 'sending' }
    this.tasks.set(key, task)
    this.publish()
    void this.run(task)
    return task
  }
  private assertAccount(task: DetailExtensionSend, signal: AbortSignal) {
    if (currentAccount() !== task.accountKey || signal.aborted) throw new Error('登录账号已变化，发送结果待核对')
  }
  private async finish(task: DetailExtensionSend, result: ArkmeSourceMessageExtendResult) {
    if (this.tasks.get(this.key(task)) !== task) return
    if (!result.extension || result.extension.recordUid !== result.recordUid) throw new Error('发送回执不完整，请核对发送结果')
    task.result = result; task.extension = result.extension; task.state = 'sent'; task.error = undefined
    this.publish()
    if (currentAccount() === task.accountKey) {
      const sdk = createArkmeSdk()
      void Promise.allSettled(task.fileRefs.map(fileRef => sdk.removeLocalFile(fileRef)))
    }
  }
  private async run(task: DetailExtensionSend) {
    const key = this.key(task), controller = new AbortController()
    this.controllers.set(key, controller)
    const signal = controller.signal
    const unsubscribe = arkmeAuthStore.subscribe(() => { if (currentAccount() !== task.accountKey) controller.abort() })
    let writeStarted = false
    let roleSnapshot: ArkmeSelfRoleSnapshot | undefined
    try {
      // Yield so the two views and the empty composer paint before any provider work.
      await Promise.resolve()
      this.assertAccount(task, signal)
      if (task.sourceKind === 'private_chat' || task.sourceKind === 'group_chat') await requirePhoneForSocialAction('发送消息', signal)
      this.assertAccount(task, signal)
      if (task.role) {
        roleSnapshot = await callArkme<ArkmeSelfRoleSnapshot>('self-roles.bind', {
          expectedUserId: task.role.userId, sourceRef: task.sourceRef, recordUid: task.recordUid, roleId: task.role.roleId,
        }, signal)
      }
      this.assertAccount(task, signal)
      writeStarted = true
      const result = await callArkme<ArkmeSourceMessageExtendResult>('source.message-extension.extend', {
        sourceRef: task.sourceRef, messageActionRef: task.messageActionRef, textContent: task.textContent,
        ...(task.textFormat === undefined ? {} : { textFormat: task.textFormat }),
        ...(task.humanMentions?.length ? { humanMentions: task.humanMentions } : {}),
        ...(task.botMentions?.length ? { botMentions: task.botMentions } : {}),
        recordUid: task.recordUid, relationUid: task.relationUid,
        ...(task.parent.itemUid === task.rootRecordUid ? {} : { parentRecordUid: task.parent.itemUid }),
        fileRefs: task.fileRefs,
      }, signal)
      if (roleSnapshot && result.recordUid !== task.recordUid) {
        this.assertAccount(task, signal)
        await callArkme('self-roles.rebind', { expectedUserId: task.role!.userId, recordUid: task.recordUid, newRecordUid: result.recordUid }, signal)
          .catch(() => { /* The confirmed result still carries the frozen role. */ })
      }
      await this.finish(task, roleSnapshot ? { ...result, extension: { ...result.extension, selfRole: roleSnapshot } } : result)
    } catch (error) {
      if (this.tasks.get(key) !== task) return
      task.state = writeStarted ? 'uncertain' : 'failed'
      task.error = error instanceof Error ? error.message : '延展发送失败，内容已保留'
      this.publish()
      if (writeStarted && currentAccount() === task.accountKey) void this.reconcile(task)
    } finally {
      unsubscribe()
      if (this.controllers.get(key) === controller) this.controllers.delete(key)
    }
  }
  retry(task: DetailExtensionSend) {
    if (task.state !== 'failed' || currentAccount() !== task.accountKey) return
    task.state = 'sending'; task.error = undefined; this.publish()
    void this.run(task)
  }
  async reconcile(task: DetailExtensionSend) {
    if (task.state !== 'uncertain' || currentAccount() !== task.accountKey) return
    task.state = 'checking'; this.publish()
    try {
      const context = await callArkme<ArkmeSourceMessageExtensionContext>('source.message-extension.context', {
        sourceRef: task.sourceRef, messageActionRef: task.messageActionRef,
      })
      if (this.tasks.get(this.key(task)) !== task) return
      const extension = context.extensions.find(item => item.recordUid === task.recordUid)
      if (extension) await this.finish(task, { recordUid: extension.recordUid, parentRecordUid: extension.parentRecordUid ?? task.parent.itemUid,
        relationUid: task.relationUid, status: 1, localState: 'synced', extension })
      else { task.state = 'uncertain'; this.publish() }
    } catch { if (this.tasks.get(this.key(task)) === task) { task.state = 'uncertain'; this.publish() } }
  }
  observe(task: DetailExtensionSend, extension: ArkmeMessageCopyLinkExtensionItem) {
    if (task.state === 'uncertain' && extension.recordUid === task.recordUid) void this.finish(task, {
      recordUid: extension.recordUid, parentRecordUid: extension.parentRecordUid ?? task.parent.itemUid,
      status: 1, localState: 'synced', extension,
    })
  }
  /** Remove retained receipts only after an authoritative timeline contains the same UID. */
  acknowledge(task: DetailExtensionSend) {
    if (task.state !== 'sent') return
    this.tasks.delete(this.key(task)); this.publish()
  }
  clear() {
    for (const controller of this.controllers.values()) controller.abort()
    this.tasks.clear(); this.publish()
  }
}
function localJournal() { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
export const detailExtensionSends = new DetailExtensionSendQueue(localJournal())
export function useDetailExtensionSends(accountKey: string | undefined, sourceKey: string) {
  const revision = useSyncExternalStore(detailExtensionSends.subscribe, detailExtensionSends.getRevision, detailExtensionSends.getRevision)
  const tasks = useMemo(() => detailExtensionSends.views(accountKey, sourceKey), [accountKey, sourceKey, revision])
  useEffect(() => { for (const task of tasks) if (task.state === 'uncertain') void detailExtensionSends.reconcile(task) }, [accountKey, sourceKey])
  return tasks
}
export function detailExtensionSendTimelineItem(task: DetailExtensionSend): ArkmeTimelineItem {
  const extension = task.result?.extension ?? task.extension
  return {
    itemUid: task.result?.recordUid ?? task.recordUid, senderName: extension.senderDisplayName || '我', isMe: true,
    sendAtMillis: extension.sendAtMillis, title: extension.title, textContent: extension.textContent,
    textFormat: extension.textFormat ?? 'plain', status: task.result?.status ?? 0,
    templateKind: extension.templateKind, displayKind: extension.displayKind,
    ...(extension.mentions === undefined ? {} : { mentions: extension.mentions }),
    ...(extension.selfRole === undefined ? {} : { selfRole: extension.selfRole }),
    ...(extension.senderAvatarUrl === undefined ? {} : { avatarRef: extension.senderAvatarUrl }),
    ...(extension.contentBlocks === undefined ? {} : { contentBlocks: extension.contentBlocks }),
    ...(task.result?.sequence === undefined ? {} : { sequence: task.result.sequence }),
    extensionParentRecordUid: task.parent.itemUid,
    extensionParent: { itemUid: task.parent.itemUid, senderName: task.parent.senderName, title: task.parent.title,
      textContent: task.parent.textContent, textFormat: task.parent.textFormat ?? 'plain',
      ...(task.parent.contentBlocks === undefined ? {} : { contentBlocks: task.parent.contentBlocks }) },
    awaitingTimelineProjection: true,
  }
}
export function DetailExtensionSendStatus({ task }: { task: DetailExtensionSend }) {
  const uncertain = task.state === 'uncertain' || task.state === 'checking'
  return <div role="status" aria-label={tr('延展发送状态')} data-arkme-extension-send-state={task.state} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, fontSize: 11, color: arkmeTheme.tertiary }}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <span title={task.error}>{task.state === 'sent' ? tr('已发送') : task.state === 'sending' ? tr('发送中…') : task.state === 'checking' ? tr('正在核对…') : uncertain ? tr('发送结果待确认') : tr('发送失败')}</span>
    {(task.state === 'failed' || task.state === 'uncertain') && <button type="button" data-arkme-feedback="neutral" style={{ border: 0, padding: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer' }}
      onClick={() => { if (uncertain) void detailExtensionSends.reconcile(task); else detailExtensionSends.retry(task) }}>{uncertain ? tr('核对发送结果') : tr('重试')}</button>}
  </div>
}
