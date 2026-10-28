import type { ArkmeFilePolicy, ArkmeLocalFile } from '../file-transfer-contract.js'
import { ARKO_IMAGE_DRAFT_LIMIT, ARKO_IMAGE_DRAFT_MAX_BYTES, ARKO_IMAGE_MIME_TYPES } from '../arko-image-contract.js'
import { createArkmeSdk } from '../sdk/index.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeAttachmentId, arkmeComposerDraftStore, releaseArkmeComposerAttachment, type ArkmeComposerAttachment } from './composer-draft-store.js'
import { tr } from './locale.js'

export interface AttachmentPreparationPort {
  get(): readonly ArkmeComposerAttachment[]
  update(change: (items: readonly ArkmeComposerAttachment[]) => readonly ArkmeComposerAttachment[]): void
  current(): boolean
  policy(signal: AbortSignal): Promise<ArkmeFilePolicy>
  stage(file: File, signal: AbortSignal): Promise<ArkmeLocalFile>
  discard(file: ArkmeLocalFile): Promise<unknown>
  imagesOnly?: boolean
}

interface Job { id: string; file: File; controller: AbortController; canceled: boolean }

/** File selection is synchronous; only preparation is queued. No File/blob URL is persisted. */
export class AttachmentPreparationQueue {
  private jobs = new Map<string, Job>()
  private tail: Promise<void> = Promise.resolve()
  private disposed = false
  constructor(private readonly port: AttachmentPreparationPort) {}

  add(files: readonly File[]): void {
    if (this.disposed || !this.port.current() || !files.length) return
    const jobs = files.map(file => ({ id: `attachment:${crypto.randomUUID()}`, file, controller: new AbortController(), canceled: false }))
    const items: ArkmeComposerAttachment[] = jobs.map(job => {
      this.jobs.set(job.id, job)
      const { file, id } = job
      const previewUrl = /^(image|video)\//.test(file.type) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined
      return { clientId: id, ...(previewUrl ? { previewUrl } : {}), preparation: {
        id, fileName: file.name, size: file.size, mimeType: file.type,
        fileKind: file.type.startsWith('image/') ? 1 : file.type.startsWith('audio/') ? 2 : file.type.startsWith('video/') ? 3 : 4,
        state: 'queued', retry: () => this.retry(id), cancel: () => this.cancel(id),
      } }
    })
    try { this.port.update(current => [...current, ...items]) }
    catch (error) { items.forEach(releaseArkmeComposerAttachment); throw error }
    for (const job of jobs) this.enqueue(job)
  }

  private present(job: Job): boolean {
    return !this.disposed && !job.canceled && this.port.current()
      && this.port.get().some(item => arkmeAttachmentId(item) === job.id && item.preparation !== undefined)
  }
  private state(job: Job, state: 'queued' | 'preparing' | 'failed', error?: string): void {
    if (!this.present(job)) return
    this.port.update(items => items.map(item => arkmeAttachmentId(item) === job.id && item.preparation
      ? { ...item, preparation: { ...item.preparation, state, error: error ?? '' } } : item))
  }
  private enqueue(job: Job): void {
    this.tail = this.tail.catch(() => {}).then(async () => {
      if (!this.present(job)) return
      this.state(job, 'preparing')
      let staged: ArkmeLocalFile | undefined
      try {
        const policy = await this.port.policy(job.controller.signal)
        if (!this.present(job)) return
        const max = this.port.imagesOnly ? Math.min(ARKO_IMAGE_DRAFT_LIMIT, policy.maxAttachments) : policy.maxAttachments
        const limit = this.port.imagesOnly ? Math.min(ARKO_IMAGE_DRAFT_MAX_BYTES, policy.maxImageBytes)
          : job.file.type.startsWith('image/') ? policy.maxImageBytes : policy.maxFileBytes
        if (this.port.get().filter(item => !item.preparation).length >= max || this.port.get().filter(item => item.preparation?.state !== 'failed').findIndex(item => arkmeAttachmentId(item) === job.id) >= max) throw new Error(tr('最多添加 {v0} 个附件', { v0: max }))
        if (this.port.imagesOnly && !ARKO_IMAGE_MIME_TYPES.some(mime => mime === job.file.type)) throw new Error(tr('支持 JPG、PNG、GIF、WebP 图片'))
        if (job.file.size <= 0 || job.file.size > limit) throw new Error(tr('文件为空或超过 {v0} MiB', { v0: Math.floor(limit / 1024 / 1024) }))
        staged = await this.port.stage(job.file, job.controller.signal)
        if (!this.present(job)) { await this.port.discard(staged).catch(() => {}); return }
        this.port.update(items => items.map(item => arkmeAttachmentId(item) === job.id
          ? { clientId: job.id, localFile: staged!, ...(item.previewUrl ? { previewUrl: item.previewUrl } : {}) } : item))
        this.jobs.delete(job.id)
      } catch (error) {
        if (staged) await this.port.discard(staged).catch(() => {})
        if (this.present(job)) this.state(job, 'failed', error instanceof Error ? error.message : tr('附件准备失败，请重试'))
      }
    })
  }
  private retry(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !this.present(job) || this.port.get().find(item => arkmeAttachmentId(item) === id)?.preparation?.state !== 'failed') return
    job.controller = new AbortController()
    this.state(job, 'queued')
    this.enqueue(job)
  }
  private cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.canceled = true; job.controller.abort(); this.jobs.delete(id)
  }
  dispose(): void {
    this.disposed = true
    for (const id of this.jobs.keys()) this.cancel(id)
  }
  async settled(): Promise<void> { await this.tail }
}

// Draft-backed queues outlive a conversation view, so switching chats cannot lose a selection.
const composerQueues = new Map<string, AttachmentPreparationQueue>()
let owner: string | undefined
let unsubscribe: (() => void) | undefined
export function prepareComposerAttachments(key: string, userId: number, files: readonly File[], imagesOnly = false): void {
  const auth = arkmeAuthStore.getSnapshot().auth
  if (auth?.status !== 'authenticated' || auth.userId !== userId) return
  const account = `${auth.environment}:${auth.userId}`
  if (owner !== account) { for (const queue of composerQueues.values()) queue.dispose(); composerQueues.clear(); owner = account }
  if (!unsubscribe) unsubscribe = arkmeAuthStore.subscribe(() => {
    const current = arkmeAuthStore.getSnapshot().auth
    if (current?.status === 'authenticated' && `${current.environment}:${current.userId}` === owner) return
    for (const queue of composerQueues.values()) queue.dispose()
    composerQueues.clear(); owner = undefined
    unsubscribe?.(); unsubscribe = undefined
  })
  let queue = composerQueues.get(key)
  if (!queue) {
    const sdk = createArkmeSdk()
    queue = new AttachmentPreparationQueue({
      get: () => arkmeComposerDraftStore.get(key).attachments,
      update: change => arkmeComposerDraftStore.updateAttachments(key, change),
      current: () => { const current = arkmeAuthStore.getSnapshot().auth; return current?.status === 'authenticated' && `${current.environment}:${current.userId}` === account },
      policy: signal => sdk.fileCapabilities(signal),
      stage: (file, signal) => sdk.stageFile(file, { expectedUserId: userId, signal }),
      discard: file => sdk.removeLocalFile(file.fileRef), imagesOnly,
    })
    composerQueues.set(key, queue)
  }
  queue.add(files)
}

export function attachmentPreparationHint(attachments: readonly ArkmeComposerAttachment[]): string | undefined {
  if (attachments.some(item => item.preparation?.state === 'failed')) return tr('有附件准备失败，请重试或移除后发送')
  if (attachments.some(item => item.preparation)) return tr('附件准备中，请稍候')
  return undefined
}
