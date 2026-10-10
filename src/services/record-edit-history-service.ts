import type { RecordOwnerId } from '../record-owner-id.js'
import type { ArkmeRecordEditHistoryPage, ArkmeRecordRevision } from '../record-edit-history.js'
import { ArkmePluginError, type ServiceRuntime, objectValue } from './service.js'

/** Produced only after existing account/source-bound message reference verification. */
export type RecordEditHistoryTarget = { viewerUserId: number; recordUid: string } & (
  | { kind: 'owned' }
  | { kind: 'chat'; chatSessionUid: string; relationUid: string; recordOwnerUserId: RecordOwnerId }
)

export interface RecordRevisionContentProjector {
  projectPage(snapshots: Record<string, unknown>[], target: RecordEditHistoryTarget, signal?: AbortSignal): Promise<ArkmeRecordRevision['content'][]>
}

function invalid(): never {
  throw new ArkmePluginError('record-edit-history-invalid', '编辑记录暂不可用，请刷新后重试', true, 502)
}

export class RecordEditHistoryService {
  constructor(private readonly runtime: Pick<ServiceRuntime, 'requireSession' | 'authenticatedPost' | 'authenticatedChatPost'>,
    private readonly projector: RecordRevisionContentProjector) {}

  async page(target: RecordEditHistoryTarget, cursorEditAt = 0, signal?: AbortSignal): Promise<ArkmeRecordEditHistoryPage> {
    if (!Number.isSafeInteger(cursorEditAt) || cursorEditAt < 0 || target.recordUid.trim() === '') invalid()
    const session = await this.runtime.requireSession()
    if (session.userId !== target.viewerUserId) invalid()
    const window = { limit: 50, ...(cursorEditAt === 0 ? {} : { cursor_edit_at: cursorEditAt }) }
    const data = objectValue(target.kind === 'owned'
      ? await this.runtime.authenticatedPost('/api/v1/records/revisions/query', { record_uid: target.recordUid, ...window }, session, signal)
      : await this.runtime.authenticatedChatPost('/api/v1/chats/records/revisions/query', {
        chat_session_uid: target.chatSessionUid, rel_uid: target.relationUid, ...window,
      }, session, signal))
    if (signal?.aborted || (await this.runtime.requireSession()).userId !== session.userId) invalid()
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') invalid()
    const next = data.next_cursor_edit_at
    if (data.has_more && (typeof next !== 'number' || !Number.isSafeInteger(next) || next <= 0 || (cursorEditAt > 0 && next >= cursorEditAt))) invalid()
    const seen = new Set<string>()
    const snapshots = data.items.flatMap((raw): Record<string, unknown>[] => {
      const revision = objectValue(raw)
      if (revision.record_uid !== target.recordUid || typeof revision.revision_uid !== 'string' || revision.revision_uid.trim() === '') invalid()
      if (revision.revision_type !== 1 && revision.revision_type !== 5) return []
      if (typeof revision.edit_at !== 'number' || !Number.isSafeInteger(revision.edit_at) || revision.edit_at <= 0 || !Number.isFinite(new Date(revision.edit_at).getTime()) || typeof revision.text_content !== 'string') invalid()
      if (seen.has(revision.revision_uid)) return []
      seen.add(revision.revision_uid)
      return [revision]
    })
    const contents = snapshots.length === 0 ? [] : await this.projector.projectPage(snapshots, target, signal)
    if (signal?.aborted || (await this.runtime.requireSession()).userId !== session.userId || contents.length !== snapshots.length) invalid()
    const items = snapshots.map((revision, index): ArkmeRecordRevision => ({
      revisionUid: revision.revision_uid as string, kind: revision.revision_type === 5 ? 'original' : 'manual',
      editAtMillis: revision.edit_at as number, content: contents[index]!,
    }))
    items.sort((a, b) => b.editAtMillis - a.editAtMillis)
    return { items, hasMore: data.has_more, ...(data.has_more ? { nextCursorEditAt: next as number } : {}) }
  }
}
