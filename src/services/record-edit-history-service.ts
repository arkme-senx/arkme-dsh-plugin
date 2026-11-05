import type { RecordOwnerId } from '../record-owner-id.js'
import type { ArkmeRecordEditHistoryPage, ArkmeRecordRevision } from '../record-edit-history.js'
import { ArkmePluginError, type ServiceRuntime, objectValue } from './service.js'
import { recordSenderSnapshot } from '../record-sender-snapshot.js'

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
function requireHistoryOwner(target: RecordEditHistoryTarget): void {
  if (target.kind === 'chat' && String(target.recordOwnerUserId) !== String(target.viewerUserId)) {
    throw new ArkmePluginError('record-history-private', '只能查看自己消息的编辑记录', false, 403)
  }
}
const revisionKinds: Record<number, ArkmeRecordRevision['kind']> = { 1: 'manual', 2: 'transcription', 3: 'polish', 4: 'rewrite', 5: 'original' }

export class RecordEditHistoryService {
  constructor(private readonly runtime: Pick<ServiceRuntime, 'requireSession' | 'authenticatedPost' | 'authenticatedChatPost'>,
    private readonly projector: RecordRevisionContentProjector) {}

  private async readPage(target: RecordEditHistoryTarget, cursorVersion = 0, signal?: AbortSignal) {
    if (!Number.isSafeInteger(cursorVersion) || cursorVersion < 0 || target.recordUid.trim() === '') invalid()
    requireHistoryOwner(target)
    const session = await this.runtime.requireSession()
    if (session.userId !== target.viewerUserId) invalid()
    const window = { limit: 50, cursor_version: cursorVersion }
    const data = objectValue(target.kind === 'owned'
      ? await this.runtime.authenticatedPost('/api/v1/records/revisions/query', { record_uid: target.recordUid, ...window }, session, signal)
      : await this.runtime.authenticatedChatPost('/api/v1/chats/records/revisions/query', {
        chat_session_uid: target.chatSessionUid, rel_uid: target.relationUid, ...window,
      }, session, signal))
    if (signal?.aborted || (await this.runtime.requireSession()).userId !== session.userId) invalid()
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') invalid()
    const next = data.next_cursor_version
    if (data.has_more && (typeof next !== 'number' || !Number.isSafeInteger(next) || next <= 0 || (cursorVersion > 0 && next >= cursorVersion))) invalid()
    const seen = new Set<string>()
    const snapshots = data.items.flatMap((raw): Record<string, unknown>[] => {
      const revision = objectValue(raw)
      if (revision.record_uid !== target.recordUid || typeof revision.revision_uid !== 'string' || revision.revision_uid.trim() === '') invalid()
      // Automatic revisions are comparison baselines too. Dropping them would
      // attribute their changes to the next manual edit.
      if (!Number.isSafeInteger(revision.revision_type) || !Number.isSafeInteger(revision.version) || Number(revision.version) <= 0) invalid()
      if (typeof revision.edit_at !== 'number' || !Number.isSafeInteger(revision.edit_at) || revision.edit_at <= 0 || !Number.isFinite(new Date(revision.edit_at).getTime()) || typeof revision.text_content !== 'string') invalid()
      if (seen.has(revision.revision_uid)) return []
      seen.add(revision.revision_uid)
      return [revision]
    })
    return { snapshots, hasMore: data.has_more, nextCursor: next as number | undefined, userId: session.userId }
  }

  async revision(target: RecordEditHistoryTarget, revisionUid: string, signal?: AbortSignal): Promise<{ snapshot: Record<string, unknown>; previous?: Record<string, unknown> }> {
    if (!revisionUid.trim() || revisionUid.length > 256) invalid()
    requireHistoryOwner(target)
    const session = await this.runtime.requireSession()
    if (session.userId !== target.viewerUserId) invalid()
    const data = objectValue(target.kind === 'owned'
      ? await this.runtime.authenticatedPost('/api/v1/records/revisions/query', { record_uid: target.recordUid, revision_uid: revisionUid }, session, signal)
      : await this.runtime.authenticatedChatPost('/api/v1/chats/records/revisions/query', {
        chat_session_uid: target.chatSessionUid, rel_uid: target.relationUid, revision_uid: revisionUid,
      }, session, signal))
    if (signal?.aborted || (await this.runtime.requireSession()).userId !== session.userId) invalid()
    if (data.has_more !== false || !Array.isArray(data.items) || data.items.length > 1) invalid()
    const snapshot = objectValue(data.items[0])
    if (data.items.length === 0) throw new ArkmePluginError('record-revision-not-found', '该版本的记忆快照暂不可用，请刷新编辑记录', false, 404)
    if (snapshot.record_uid !== target.recordUid || snapshot.revision_uid !== revisionUid || typeof snapshot.text_content !== 'string') invalid()
    return { snapshot }
  }

  async page(target: RecordEditHistoryTarget, cursorVersion = 0, signal?: AbortSignal): Promise<ArkmeRecordEditHistoryPage> {
    const { snapshots, hasMore, nextCursor, userId } = await this.readPage(target, cursorVersion, signal)
    const contents = snapshots.length === 0 ? [] : await this.projector.projectPage(snapshots, target, signal)
    if (signal?.aborted || (await this.runtime.requireSession()).userId !== userId || contents.length !== snapshots.length) invalid()
    const items = snapshots.map((revision, index): ArkmeRecordRevision => {
      const author = recordSenderSnapshot({ ...revision, sender_snapshot: revision.editor_snapshot })
      return {
      revisionUid: revision.revision_uid as string,
      version: Number(revision.version),
      kind: revisionKinds[revision.revision_type as number] ?? 'other',
      editAtMillis: revision.edit_at as number, content: contents[index]!,
      ...(author.avatarRef === undefined ? {} : { avatarRef: author.avatarRef }),
      ...(author.senderNameSnapshot ? { senderName: author.senderName } : {}),
    } })
    // The owner version is causal order. Client clocks can tie or move backwards.
    if (items.some((item, index) => index > 0 && item.version! >= items[index - 1]!.version!)) invalid()
    return { items, hasMore, ...(hasMore ? { nextCursorVersion: nextCursor! } : {}) }
  }
}
