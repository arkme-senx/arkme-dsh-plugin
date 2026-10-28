import type { ArkmeArkoLifecycleCommand, ArkmeArkoLifecycleItem, ArkmeArkoLifecycleResult, ArkmeArkoLifecycleSnapshot, ArkmeArkoDeletedPage } from '../arko-lifecycle-contract.js'
import type { ArkmeArkoHistoryItem } from '../types.js'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

const invalid = () => new ArkmePluginError('arko-lifecycle-invalid', '消息状态或引用无效，请刷新后重试', false, 400)
const contract = () => new ArkmePluginError('arko-lifecycle-unavailable', '消息状态暂时无法确认，请重试', true, 502)
const options = { lane: 'interactive-read' as const, bypassCache: true, cacheMs: 0 }
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0

/** Host adapter; all permissions, eligibility and retention decisions stay at the
 * message owner. No operation queue or local deletion truth is maintained. */
export class ArkoLifecycle {
  constructor(private readonly runtime: ServiceRuntime, private readonly codec: EncryptedReferenceCodec,
    private readonly ref: (user: number, session: number, message: number) => Promise<string>,
    private readonly project: (raw: unknown[], user: number) => Promise<ArkmeArkoHistoryItem[]>) {}

  private async identities(refs: readonly string[], user: number) {
    if (!Array.isArray(refs) || refs.length > 100 || new Set(refs).size !== refs.length) throw invalid()
    const result = await Promise.all(refs.map(async ref => {
      if (typeof ref !== 'string') throw invalid()
      const data = await this.codec.open('arkme-arko-message-v1', ref)
      if (data.environment !== this.runtime.config.environment || data.userId !== user || !integer(data.messageId) || data.messageId < 1 || !integer(data.sessionId) || data.sessionId < 1 || Number(data.expiresAtMillis) <= Date.now()) throw invalid()
      return { message_id: data.messageId, session_id: data.sessionId }
    }))
    if (new Set(result.map(item => item.message_id)).size !== result.length) throw invalid()
    return result
  }

  private async item(raw: unknown, user: number, ref?: string): Promise<ArkmeArkoLifecycleItem> {
    const v = objectValue(raw)
    if (!integer(v.message_id) || v.message_id < 1 || !integer(v.session_id) || !integer(v.version)
      || !integer(v.deleted_at_ms) || !integer(v.purge_at_ms) || typeof v.last_operation_uid !== 'string'
      || !['active', 'deleted', 'expired', 'unavailable'].includes(String(v.state)) || (v.state !== 'unavailable' && v.session_id < 1)) throw contract()
    return { messageRef: ref ?? await this.ref(user, v.session_id, v.message_id), messageKey: `${v.session_id}:${v.message_id}`,
      version: v.version, state: v.state as ArkmeArkoLifecycleItem['state'], deletedAtMillis: v.deleted_at_ms, purgeAtMillis: v.purge_at_ms,
      lastOperationUid: v.last_operation_uid, relatedMessageDeleted: v.related_message_deleted === true, ...(typeof v.delete_blocked_reason === 'string' ? { deleteBlockedReason: v.delete_blocked_reason } : {}) }
  }

  async query(refs: readonly string[] = [], signal?: AbortSignal): Promise<ArkmeArkoLifecycleSnapshot> {
    const session = await this.runtime.requireSession(), ids = await this.identities(refs, session.userId)
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/lifecycle/query', { message_ids: ids.map(i => i.message_id) }, session, signal, options)
    if (!integer(data.revision) || !Array.isArray(data.items) || data.items.length !== ids.length) throw contract()
    const items = await Promise.all(data.items.map(async (raw, i) => {
      const item = objectValue(raw)
      if (item.message_id !== ids[i]!.message_id || (item.state !== 'unavailable' && item.session_id !== ids[i]!.session_id)) throw contract()
      return { ...await this.item(raw, session.userId, refs[i]), messageKey: `${ids[i]!.session_id}:${ids[i]!.message_id}` }
    }))
    return { revision: data.revision, items }
  }

  async change(command: ArkmeArkoLifecycleCommand, signal?: AbortSignal): Promise<ArkmeArkoLifecycleResult> {
    if (!command || !['delete', 'restore'].includes(command.action) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(command.operationUid)
      || !Array.isArray(command.targets) || !command.targets.length || command.targets.some(t => !t || !integer(t.expectedVersion))) throw invalid()
    const session = await this.runtime.requireSession(), refs = command.targets.map(t => t.messageRef), ids = await this.identities(refs, session.userId)
    try {
      const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/lifecycle/apply', {
        action: command.action, operation_uid: command.operationUid, targets: ids.map((id, i) => ({ ...id, expected_version: command.targets[i]!.expectedVersion })),
      }, session, signal, { bypassCache: true, cacheMs: 0 })
      if (data.protocol_version !== 1 || !Array.isArray(data.items) || data.items.length !== ids.length) throw contract()
      const items = await Promise.all(data.items.map(async (raw, i) => {
        const value = objectValue(raw)
        if (value.message_id !== ids[i]!.message_id || (value.state !== 'unavailable' && value.session_id !== ids[i]!.session_id) || typeof value.result !== 'string') throw contract()
        return { ...await this.item(value, session.userId, refs[i]), messageKey: `${ids[i]!.session_id}:${ids[i]!.message_id}`, result: value.result }
      }))
      return { operationUid: command.operationUid, items }
    } catch (error) {
      // A failed transport can follow a committed write. Never replay it or claim
      // failure. Query with the same identities; an absent receipt stays unknown.
      signal?.throwIfAborted()
      try {
        const snapshot = await this.query(refs, signal)
        return { operationUid: command.operationUid, items: snapshot.items.map((item, i) => ({ ...item,
          result: item.lastOperationUid === command.operationUid && item.version === command.targets[i]!.expectedVersion + 1
            && item.state === (command.action === 'delete' ? 'deleted' : 'active') ? 'already_applied' : 'unknown' })) }
      } catch { throw new ArkmePluginError('arko-lifecycle-outcome-unknown', '操作结果尚未确认，请核对消息状态；不要重复提交', true, 503) }
    }
  }

  async recent(cursor?: string, signal?: AbortSignal): Promise<ArkmeArkoDeletedPage> {
    const session = await this.runtime.requireSession()
    let after: unknown
    if (cursor) {
      const data = await this.codec.open('arkme-arko-deleted-cursor-v1', cursor)
      if (data.environment !== this.runtime.config.environment || data.userId !== session.userId || Number(data.expiresAtMillis) <= Date.now()) throw invalid()
      after = data.after
    }
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/recently-deleted/query', { limit: 50, ...(after ? { after } : {}) }, session, signal, options)
    if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.has_more !== 'boolean' || (data.has_more && !data.next)) throw contract()
    const items = await Promise.all(data.items.map(raw => this.item(raw, session.userId)))
    const detail = items.length ? await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/messages/recently-deleted/details', { anchors: data.items.map(raw => { const v = objectValue(raw); return { session_id: v.session_id, message_id: v.message_id } }) }, session, signal, options) : { items: [] }
    if (!Array.isArray(detail.items)) throw contract()
    const messages = await this.project(detail.items, session.userId)
    const byKey = new Map(messages.map(m => [`${m.sessionId}:${m.messageId}`, m]))
    return { items: items.map(item => ({ ...item, ...(byKey.has(item.messageKey) ? { message: byKey.get(item.messageKey)! } : {}) })), hasMore: data.has_more,
      ...(data.has_more ? { nextCursor: await this.codec.seal('arkme-arko-deleted-cursor-v1', { environment: this.runtime.config.environment, userId: session.userId, after: data.next, expiresAtMillis: Date.now() + 24*60*60_000 }) } : {}) }
  }
}
