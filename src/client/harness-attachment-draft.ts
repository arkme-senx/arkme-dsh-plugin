/** Compatibility face for DSH 0.1.5 native draft services. No send capability is exposed. */
export interface Snapshot<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export interface DraftInput {
  state: Snapshot<{ draft: string; draftRev: number; attachmentIds: readonly string[]; phase: string }>
  addAttachments(ids: readonly string[]): boolean
}
export interface NativeDraft { id: string; kind: 'image' | 'file'; file: File; width?: number; height?: number }
export interface DraftConversation {
  input: { for(scope: unknown): DraftInput }
  createDrafts(id: string, files: readonly File[]): readonly NativeDraft[]
  releaseDraftAttachments(drafts: readonly NativeDraft[]): void
  fileUploads: Snapshot<Record<string, { status: string; message?: string }>>
}
export interface DraftSessions {
  list: Snapshot<{ current?: string; byId: Record<string, { workspaceId?: string }> }>
  create(options: { sessionId: string; workspaceId?: string }): Promise<string>
  open(id: string): void
  scope(id: string): { get(key: string): unknown } | undefined
  binding(id: string): { session: { projections: { faceOf(key: string): Snapshot<unknown> } } } | undefined
}
export interface DraftRequest {
  operationId: string
  files: readonly File[]
  signal: AbortSignal
  progress?: (text: string) => void
}
export interface HarnessDraftBridge {
  prepare(request: DraftRequest): Promise<{ sessionId: string }>
  dispose(): void
}
export const HARNESS_ATTACHMENT_DRAFT_KEY = '__arkmeHarnessAttachmentDraft'
export type HarnessDraftWindow = Window & { [HARNESS_ATTACHMENT_DRAFT_KEY]?: HarnessDraftBridge }
const unsupported = () => new Error('当前 DSH 版本不支持附件草稿，请升级客户端后重试')

export function abortableDelay(signal: AbortSignal, ms = 100): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('操作已取消')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Cancellation stops the waiter; a late create still belongs to the same retry identity. */
function waitForDraftOperation<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('操作已取消'))
    signal.addEventListener('abort', abort, { once: true })
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => {
      signal.removeEventListener('abort', abort); reject(error)
    })
  })
}

/** Each operation owns a fresh identity, including retries after uncertain create responses. */
export function createHarnessDraftBridge(sessions: DraftSessions, isCurrentAccount: () => boolean, defaultWorkspace?: () => Promise<string>): HarnessDraftBridge {
  const lifetime = new AbortController()
  const attempts = new Map<string, { id: string; created: boolean; complete: boolean; busy: boolean; revision?: number; creation?: Promise<string> | undefined }>()
  return {
    dispose() { lifetime.abort(); attempts.clear() },
    async prepare(request) {
      if (!sessions.create || !sessions.scope || !sessions.binding) throw unsupported()
      const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(120_000)])
      const check = () => { signal.throwIfAborted(); if (!isCurrentAccount()) throw new Error('账号或 DSH 窗口已切换，请重试') }
      check()
      let attempt = attempts.get(request.operationId)
      if (!attempt) {
        attempt = { id: crypto.randomUUID(), created: false, complete: false, busy: false }
        attempts.set(request.operationId, attempt)
      }
      if (attempt.busy) throw new Error('正在准备附件，请勿重复点击')
      if (attempt.complete) return { sessionId: attempt.id }
      attempt.busy = true
      const previous = sessions.list.getSnapshot().current
      let conversation: DraftConversation | undefined
      let drafts: readonly NativeDraft[] = []
      try {
        // Detect capability before creating a session when a scope is already present.
        if (previous) {
          const existing = sessions.scope(previous)?.get('conversation') as Partial<DraftConversation> | undefined
          if (existing && typeof existing.createDrafts !== 'function') throw unsupported()
        }
        if (!attempt.created) {
          request.progress?.('正在创建 DSH 新对话…')
          if (!defaultWorkspace) throw unsupported()
          attempt.creation ??= (async () => {
            const workspaceId = await defaultWorkspace()
            check()
            if (!workspaceId) throw new Error('默认工作区尚未就绪，请重试')
            return sessions.create({ sessionId: attempt.id, workspaceId })
          })().then(id => {
            attempt.id = id; attempt.created = true; return id
          }).catch(error => { attempt.creation = undefined; throw error })
          await waitForDraftOperation(attempt.creation, signal)
          check()
        }
        const scope = sessions.scope(attempt.id)
        conversation = scope?.get('conversation') as DraftConversation | undefined
        if (!scope || !conversation?.createDrafts || !conversation.fileUploads || !conversation.input?.for) throw unsupported()
        const input = conversation.input.for(scope)
        const initial = input.state.getSnapshot()
        if (initial.draft !== '' || initial.attachmentIds.length || initial.phase !== 'plain'
          || (attempt.revision !== undefined && attempt.revision !== initial.draftRev)) throw new Error('目标对话草稿已被编辑，请重新选择快记后操作')
        attempt.revision = initial.draftRev
        // Opening loads authoritative projections; Arkme keeps this surface hidden until ready.
        const selected = sessions.list.getSnapshot().current
        if (selected !== previous && selected !== attempt.id) throw new Error('DSH 对话已切换，请重试')
        sessions.open(attempt.id)
        const current = () => {
          check()
          if (sessions.list.getSnapshot().current !== attempt.id) throw new Error('DSH 对话已切换，请重试')
          const now = input.state.getSnapshot()
          if (now.draftRev !== initial.draftRev || now.attachmentIds.length || now.phase !== 'plain') throw new Error('目标对话草稿已被编辑，已停止添加附件')
        }
        current()
        const images = request.files.filter(file => /^image\/(png|jpeg|webp|gif)$/.test(file.type))
        if (images.length) {
          const projection = sessions.binding(attempt.id)?.session.projections.faceOf('imageLimits')
          if (!projection) throw unsupported()
          const deadline = Date.now() + 15_000
          while (!projection.getSnapshot()) {
            current(); if (Date.now() > deadline) throw new Error('DSH 图片限制尚未就绪，请稍后重试')
            await abortableDelay(signal)
          }
          const limits = projection.getSnapshot() as { maxImagesPerMessage: number; maxImageBytes: number; maxMessageImageBytes: number; mediaTypes: readonly string[] }
          if (!Array.isArray(limits.mediaTypes) || !Number.isFinite(limits.maxImageBytes)) throw unsupported()
          if (images.length > limits.maxImagesPerMessage || images.some(file => !limits.mediaTypes.includes(file.type) || file.size > limits.maxImageBytes)
            || images.reduce((sum, file) => sum + file.size, 0) > limits.maxMessageImageBytes) throw new Error('所选图片超过当前 DSH 的格式、数量或大小限制，请减少选择')
        }
        current()
        // Register individually so a partial synchronous failure can release all earlier drafts.
        for (const file of request.files) drafts = [...drafts, ...conversation.createDrafts(attempt.id, [file])]
        while (true) {
          current()
          const uploads = conversation.fileUploads.getSnapshot()
          const failed = drafts.find(draft => draft.kind === 'file' && uploads[draft.id]?.status === 'error')
          if (failed) throw new Error(`${failed.file.name}：${uploads[failed.id]?.message || '上传失败'}`)
          const ready = drafts.filter(draft => draft.kind === 'image' || uploads[draft.id]?.status === 'ready').length
          request.progress?.(`正在准备 DSH 附件 ${ready} / ${drafts.length}`)
          if (ready === drafts.length) break
          await abortableDelay(signal)
        }
        current()
        if (!input.addAttachments(drafts.map(draft => draft.id))) throw new Error('DSH 输入框正忙，请重试')
        attempt.complete = true
        return { sessionId: attempt.id }
      } catch (error) {
        if (drafts.length) conversation?.releaseDraftAttachments(drafts)
        // Never take selection back from a user who navigated elsewhere.
        if (isCurrentAccount() && previous && sessions.list.getSnapshot().current === attempt.id) sessions.open(previous)
        throw error
      } finally { attempt.busy = false }
    },
  }
}
