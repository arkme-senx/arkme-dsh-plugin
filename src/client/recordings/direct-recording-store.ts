import type { ArkmeMembership } from '../../types.js'
import { recordingCoverageContains } from '../../recording-coverage.js'
import { callArkme, uploadArkmeRecording } from '../api.js'
import { captureMicrophone, type MicrophoneCapture, type MicrophoneCaptureOptions } from './direct-recording-capture.js'
import { IndexedMicrophoneJournal, type LocalMicrophoneRecording, type MicrophoneJournal } from './direct-recording-journal.js'

export interface DirectRecordingAccount { key: string; userId: number; importPath: string }
export interface DirectRecordingSnapshot {
  accountKey?: string
  phase: 'idle' | 'starting' | 'recording' | 'saving' | 'uploading'
  elapsedMillis: number
  maxMillis: number
  levels: readonly number[]
  pending: readonly LocalMicrophoneRecording[]
  /** Account-local handoff metadata until the cloud day index catches up; contains no audio. */
  submitted?: readonly LocalMicrophoneRecording[]
  message: string
  error: string
  progress: number
  acceptedRevision: number
  startedAt: number
  volatile: boolean
}
export interface DirectRecordingDependencies {
  journal: MicrophoneJournal
  capture(options: MicrophoneCaptureOptions): Promise<MicrophoneCapture>
  membership(userId: number, signal: AbortSignal): Promise<ArkmeMembership>
  upload: typeof uploadArkmeRecording
  lock(): Promise<() => void>
  now(): number
  id(): string
}

/** Same limits as Flutter AudioLongRecordingManager: free / VIP / SVIP. */
export function directRecordingLimit(member: ArkmeMembership, now: number): number {
  const active = member.expireAtMillis === null || member.expireAtMillis > now
  return (active ? [5, 60, 120][member.memberType] ?? 5 : 5) * 60_000
}

export async function lockDirectRecording(): Promise<() => void> {
  if (!navigator.locks) throw new Error('当前浏览器不支持安全的多窗口录音，请更新浏览器后重试')
  return await new Promise((resolve, reject) => {
    void navigator.locks.request('arkme.direct-microphone', { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('其他预览窗口正在录音或保存，请先在该窗口结束')); return }
      await new Promise<void>(release => resolve(release))
    }).catch(reject)
  })
}

const initial = (): DirectRecordingSnapshot => ({ phase: 'idle', elapsedMillis: 0, maxMillis: 0, levels: [], pending: [], submitted: [], message: '', error: '', progress: 0, acceptedRevision: 0, startedAt: 0, volatile: false })
const errorText = (error: unknown) => error instanceof Error ? error.message : '录音操作失败，请重试'

interface CaptureSession {
  generation: number
  account: DirectRecordingAccount
  record?: LocalMicrophoneRecording
  capture?: MicrophoneCapture
  release: () => void
  queue: Promise<void>
  tail: ArrayBuffer[]
  writeError: string
  queued: number
  bytes: number
  stopping?: Promise<void>
}

/** Lives above recording/conversation routes; changing pages never owns microphone lifetime. */
export class DirectRecordingStore {
  private state = initial()
  private listeners = new Set<() => void>()
  private account: DirectRecordingAccount | undefined
  private generation = 0
  private scope = new AbortController()
  private session: CaptureSession | undefined
  private emergency = new Map<string, ArrayBuffer[]>()
  private storageReady = false
  readonly getSnapshot = () => this.state
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  confirmSubmittedCoverage(accountKey: string, intervals: readonly { startAtMillis: number; endAtMillis: number }[]): void {
    if (this.state.accountKey !== accountKey) return
    const previous = this.state.submitted ?? []
    const submitted = previous.filter(record => !recordingCoverageContains(intervals, record.startedAt, record.startedAt + record.bytes / (record.sampleRate * 2) * 1000))
    if (submitted.length !== previous.length) this.publish({ submitted })
  }
  constructor(private readonly deps: DirectRecordingDependencies) {}
  private publish(update: Partial<DirectRecordingSnapshot>) {
    this.state = { ...this.state, ...update }; this.listeners.forEach(listener => listener())
  }
  configure(account: DirectRecordingAccount | undefined): void {
    if (account?.key === this.account?.key && account?.importPath === this.account?.importPath) return
    const previous = this.session
    this.generation++; this.scope.abort(); this.scope = new AbortController(); this.account = account
    this.session = undefined; this.storageReady = false
    this.state = { ...initial(), volatile: this.emergency.size > 0, ...(account ? { accountKey: account.key } : {}) }; this.publish({})
    if (previous) void this.finishSession(previous, false)
    if (account) void this.refresh(this.generation)
  }
  private valid(generation: number) { return generation === this.generation && this.account !== undefined }
  private async refresh(generation: number) {
    const account = this.account
    if (!account) return
    try {
      const pending = await this.deps.journal.list(account.key)
      if (this.valid(generation)) { this.storageReady = true; this.publish({ pending }) }
    } catch { if (this.valid(generation)) this.publish({ error: '无法使用本地录音存储，请允许浏览器保存网站数据后重试' }) }
  }
  async start(): Promise<void> {
    const account = this.account
    if (!account || this.state.phase !== 'idle') return
    const generation = this.generation; const signal = this.scope.signal
    this.publish({ phase: 'starting', error: '', message: '正在准备麦克风…', elapsedMillis: 0, levels: [] })
    let session: CaptureSession | undefined
    try {
      if (!this.storageReady) { await this.refresh(generation); if (!this.storageReady) throw new Error('本地保存不可用，未开始录音') }
      const release = await this.deps.lock()
      if (!this.valid(generation)) { release(); return }
      session = { generation, account, release, queue: Promise.resolve(), tail: [], writeError: '', queued: 0, bytes: 0 }
      this.session = session
      const member = await this.deps.membership(account.userId, signal)
      if (!this.valid(generation) || signal.aborted) return
      if (member.userId !== account.userId) throw new Error('账号已变化，请重新开始录音')
      const maxMillis = directRecordingLimit(member, this.deps.now())
      this.publish({ maxMillis })
      const current = session
      current.capture = await this.deps.capture({
        signal, maxMillis,
        onReady: async sampleRate => {
          if (!this.valid(generation)) throw new Error('账号已切换，未开始录音')
          const startedAt = this.deps.now(); const id = this.deps.id()
          const stamp = new Date(startedAt).toLocaleString('sv-SE').replace(/[^0-9]/g, '')
          const record: LocalMicrophoneRecording = { id, accountKey: account.key, userId: account.userId, startedAt, sampleRate, bytes: 0, chunks: 0, finished: false, fileName: `即我录音-${stamp}-${id.slice(0, 8)}.wav` }
          await this.deps.journal.create(record); current.record = record
          if (!this.valid(generation)) throw new Error('账号已切换，未开始录音')
          this.publish({ startedAt })
        },
        onChunk: (pcm, level) => this.chunk(current, pcm, level),
        onInterrupted: reason => { void this.finishSession(current, false, reason) },
      })
      if (!this.valid(generation) || current.stopping) { await current.capture.stop(); return }
      this.publish({ phase: 'recording', message: '正在录音' })
    } catch (error) {
      if (session?.record && !session.bytes) await this.deps.journal.remove(session.record.id).catch(() => undefined)
      if (this.valid(generation)) this.publish({ phase: 'idle', message: '', error: errorText(error) })
    } finally {
      if (session && (!session.capture || !this.valid(generation))) {
        session.release(); if (this.session === session) this.session = undefined
        if (this.valid(generation)) await this.refresh(generation)
      }
    }
  }
  private chunk(session: CaptureSession, pcm: ArrayBuffer, level: number) {
    const record = session.record
    if (!record || !pcm.byteLength) return
    session.bytes += pcm.byteLength; session.queued++
    if (this.valid(session.generation)) this.publish({ elapsedMillis: session.bytes / (record.sampleRate * 2) * 1000, levels: [...this.state.levels.slice(-23), level] })
    session.queue = session.queue.then(async () => {
      if (session.writeError) { session.tail.push(pcm); return }
      try { await this.deps.journal.append(record.id, pcm) }
      catch {
        session.tail.push(pcm); session.writeError = '本地保存失败，录音已停止。请先下载备份，勿关闭页面'
        void this.finishSession(session, false, session.writeError)
      }
    }).finally(() => { session.queued-- })
    if (session.queued > 8) void this.finishSession(session, false, '本地保存速度不足，已停止录音以保护已录内容')
  }
  async stop(): Promise<void> {
    if (this.session) await this.finishSession(this.session, true)
  }
  private async finishSession(session: CaptureSession, upload: boolean, reason = ''): Promise<void> {
    if (session.stopping) return await session.stopping
    session.stopping = (async () => {
      const current = () => this.valid(session.generation)
      if (current()) this.publish({ phase: 'saving', message: '正在保存录音…', error: reason })
      try {
        await session.capture?.stop(); await session.queue
        if (session.record && session.bytes === 0) {
          await this.deps.journal.remove(session.record.id)
          reason = reason || '录音过短，尚未录到音频，请重新开始'
        } else if (session.record) {
          if (session.tail.length) { this.emergency.set(session.record.id, session.tail); this.publish({ volatile: true }) }
          // Keep an unfinished journal retryable after a disk-write failure.
          if (!session.tail.length) await this.deps.journal.finish(session.record.id)
        }
      } catch (error) { reason = `录音已停止，保存未完成：${errorText(error)}` }
      finally {
        session.release(); if (this.session === session) this.session = undefined
      }
      if (!current()) return
      this.publish({ phase: 'idle', message: '录音已保存在本机', error: session.writeError || reason })
      await this.refresh(session.generation)
      if (upload && session.record && !session.writeError && !reason) await this.upload(session.record.id)
    })()
    return await session.stopping
  }
  async upload(id: string): Promise<void> {
    const account = this.account; const generation = this.generation
    const record = this.state.pending.find(item => item.id === id)
    if (!account || !record || this.state.phase !== 'idle') return
    const signal = this.scope.signal
    this.publish({ phase: 'uploading', progress: 0, message: '正在提交录音…', error: '' })
    let release: (() => void) | undefined
    try {
      release = await this.deps.lock()
      if (!this.valid(generation)) return
      const file = await this.deps.journal.file(id, this.emergency.get(id))
      if (!this.valid(generation)) return
      // Sending the captured user id (never 0) lets the host reject account changes.
      await this.deps.upload(account.importPath, file, record.startedAt, account.userId, {
        signal, onProgress: progress => { if (this.valid(generation)) this.publish({ progress: progress.totalBytes ? progress.uploadedBytes / progress.totalBytes : 0 }) },
      })
      // Host accepted and durably owns the file/upload job; safe to clear this browser's copy.
      await this.deps.journal.remove(id); this.emergency.delete(id)
      if (this.valid(generation)) this.publish({ submitted: [...(this.state.submitted ?? []).filter(item => item.id !== id), record], volatile: this.emergency.size > 0, message: '录音已提交，可在录音导入任务中查看转写进度', acceptedRevision: this.state.acceptedRevision + 1 })
    } catch (error) {
      if (this.valid(generation)) this.publish({ error: `${errorText(error)}；录音仍保留在本机，可重试或下载`, message: '' })
    } finally {
      release?.()
      if (this.valid(generation)) { this.publish({ phase: 'idle' }); await this.refresh(generation) }
    }
  }
  async download(id: string): Promise<File | undefined> {
    if (this.state.phase !== 'idle' || !this.state.pending.some(item => item.id === id)) return
    const generation = this.generation
    let release: (() => void) | undefined
    try {
      release = await this.deps.lock()
      const file = await this.deps.journal.file(id, this.emergency.get(id))
      return this.valid(generation) ? file : undefined
    } catch (error) { if (this.valid(generation)) this.publish({ error: errorText(error) }); return }
    finally { release?.() }
  }
}

export const directRecordingStore = new DirectRecordingStore({
  journal: new IndexedMicrophoneJournal(), capture: captureMicrophone,
  membership: (userId, signal) => callArkme<ArkmeMembership>('membership.current', { expectedUserId: userId }, signal),
  upload: (...args) => uploadArkmeRecording(...args), lock: lockDirectRecording, now: () => Date.now(), id: () => crypto.randomUUID(),
})
