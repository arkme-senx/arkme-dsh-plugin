import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
import type { ReactionRequest, ReactionTargetRef } from '../reaction-contract.js'
import { createHash } from 'node:crypto'

function invalid(): never { throw new ArkmePluginError('reaction-response-invalid', '表态数据不完整，请重试', true) }
function integer(value: unknown, min = 0): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? value : invalid() }
function expression(raw: unknown) {
  const value = objectValue(raw)
  if (typeof value.text !== 'string' || Array.from(value.text).length > 20) return invalid()
  const result: import('../reaction-contract.js').ReactionExpression = { text: value.text }
  for (const key of ['emoji', 'hand', 'color'] as const) if (value[key] !== undefined) { if (typeof value[key] !== 'string' || value[key].length > 64) return invalid(); result[key] = value[key] }
  return result
}
function array(raw: unknown, max: number): unknown[] { return Array.isArray(raw) && raw.length <= max ? raw : invalid() }
function key(raw: unknown): string { return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw) ? raw : invalid() }
function group(raw: unknown) {
  const value = objectValue(raw)
  return { key: key(value.key), expression: expression(value.expression), count: integer(value.count, 1), actorIds: array(value.actor_user_ids ?? [], 3).map(id => integer(id, 1)) }
}
function state(raw: unknown) {
  const value = objectValue(raw)
  return { revision: integer(value.revision), selections: array(value.selections, 56).map(raw => { const item = objectValue(raw); return { key: key(item.key), expression: expression(item.expression), at: integer(item.at) } }) }
}
function library(raw: unknown) { const value = objectValue(raw); return { revision: integer(value.revision), items: array(value.items, 58).map(expression) } }
function boolean(raw: unknown): boolean { return typeof raw === 'boolean' ? raw : invalid() }

export interface ReactionWireTarget { chat_session_uid?: string; rel_uid?: string; record_uid?: string; owned?: boolean }
function targetKey(target: ReactionWireTarget): string { return JSON.stringify([target.chat_session_uid ?? '', target.rel_uid ?? '', target.record_uid ?? '', target.owned === true]) }
/** One Host owner for Browser, SDK and granted Tools; identities are resolved from signed message references. */
export class ReactionService {
  constructor(private readonly runtime: Pick<ServiceRuntime, 'requireSession' | 'authenticatedPost' | 'config'>,
    private readonly resolve: (target: ReactionTargetRef) => Promise<ReactionWireTarget>,
    private readonly worldReference?: (recordUID: string) => Promise<string>,
 private readonly chatSourceKey?: (viewer: number, sessionUID: string) => Promise<string>,
 private readonly historyContext?: (items: { sessionUID: string; senderID: number; sourceKind: string; message?: { recordUID: string; ownerUserID: number; sendAtMillis: number } }[], signal?: AbortSignal) => Promise<import('../reaction-contract.js').ReactionHistoryContext[]>) {}
  async request(input: ReactionRequest, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession()
    const accountKey = `${this.runtime.config.environment}:${session.userId}`
    if (!input || input.accountKey !== accountKey) throw new ArkmePluginError('reaction-account-changed', '账号已变化，请重新打开表态', false)
    let path: string, body: Record<string, unknown>
    const ids = new Map<string, string[]>()
    const resolve = async (target: ReactionTargetRef) => {
      if (!target || typeof target.id !== 'string' || !target.id || target.id.length > 1024 || !(typeof target.worldRecordRef === 'string' && !target.sourceRef && !target.messageActionRef || !target.worldRecordRef && typeof target.sourceRef === 'string' && typeof target.messageActionRef === 'string')) throw new ArkmePluginError('reaction-target-invalid', '表态目标无效', false)
      return await this.resolve(target)
    }
    switch (input.action) {
      case 'notifications': path = 'notifications/query'; body = { after_id: input.after_id ?? '', limit: input.limit }; break
      case 'notifications-read':
        if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) return invalid()
        path = 'notifications/read'; body = { items: input.items.map(item => ({ id: key(item.id), revision: integer(item.revision, 1) })) }; break

      case 'query': {
        if (!Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 50) throw new ArkmePluginError('reaction-query-invalid', '表态查询数量无效', false)
        const targets = [], seenIDs = new Set<string>()
        for (const target of input.targets) {
          const wire = await resolve(target), key = targetKey(wire)
          if (seenIDs.has(target.id)) throw new ArkmePluginError('reaction-query-duplicate', '表态目标重复', false)
          seenIDs.add(target.id)
          const aliases = ids.get(key)
          if (aliases) aliases.push(target.id)
          else { ids.set(key, [target.id]); targets.push(wire) }
        }
        path = 'query'; body = { targets }; break
      }
      case 'set':
        if (typeof input.active !== 'boolean') throw new ArkmePluginError('reaction-state-invalid', '缺少表态状态', false)
        path = 'set'; body = { target: await resolve(input.target), expression: input.expression, active: input.active, expected_revision: input.expected_revision, request_id: input.request_id }; break
      case 'actors': path = 'actors/query'; body = { target: await resolve(input.target), key: input.key, after_user_id: input.after_user_id, limit: input.limit }; break
      case 'groups': path = 'groups/query'; body = { target: await resolve(input.target), after_key: input.after_key, limit: input.limit }; break
      case 'history': path = 'history/query'; body = { start_at: input.start_at, end_at: input.end_at, limit: input.limit, ...(input.before_at === undefined ? {} : { before_at: input.before_at, before_id: input.before_id }) }; break
      case 'received': path = 'received/query'; body = { limit: input.limit, world_only: input.world_only, ...(input.before_at === undefined ? {} : { before_at: input.before_at, before_id: input.before_id }) }; break
      case 'history-policy-query': path = 'history-policy/query'; body = {}; break
      case 'history-policy-set': path = 'history-policy/set'; body = { expected_revision: input.expected_revision, locked: input.locked }; break
      case 'library-query': path = 'library/query'; body = {}; break
      case 'library-set': path = 'library/set'; body = { items: input.items, expected_revision: input.expected_revision, request_id: input.request_id }; break
      default: throw new ArkmePluginError('reaction-operation-invalid', '不支持的表态操作', false)
    }
    const before = await this.runtime.requireSession()
    if (`${this.runtime.config.environment}:${before.userId}` !== accountKey) throw new ArkmePluginError('reaction-account-changed', '账号已变化', false)
    const result = objectValue(await this.runtime.authenticatedPost(`/api/v1/reactions/${path}`, body, session, signal))
    const current = await this.runtime.requireSession()
    if (signal?.aborted || `${this.runtime.config.environment}:${current.userId}` !== accountKey) throw new ArkmePluginError('reaction-account-changed', '账号已变化', false)
    if (input.action === 'query') {
      if (!Array.isArray(result.items)) throw new ArkmePluginError('reaction-response-invalid', '表态数据不完整', true)
      const seen = new Set<string>()
      return { items: array(result.items, 50).flatMap(raw => {
        const item = objectValue(raw), target = objectValue(item.target), wireKey = targetKey(target as ReactionWireTarget), aliases = ids.get(wireKey)
        if (!aliases || seen.has(wireKey)) return invalid()
        seen.add(wireKey)
        const snapshot = { mine: state(item.mine), groups: array(item.groups, 100).map(group), has_more: boolean(item.has_more), actors_visible: boolean(item.actors_visible), private: boolean(item.private) }
        return aliases.map(id => ({target_id:id,...snapshot}))
      }) }
    }
    if (input.action === 'notifications-read') return { ok: boolean(result.ok) }
    if (input.action === 'notifications') {
      if (!this.chatSourceKey) return invalid()
      const items = await Promise.all(array(result.items, 50).map(async raw => {
        const item = objectValue(raw), target = objectValue(item.target)
        if (typeof target.chat_session_uid !== 'string' || !target.chat_session_uid || typeof item.record_uid !== 'string' || !item.record_uid) return invalid()
        return { id: key(item.id), revision: integer(item.revision, 1), actorUserId: integer(item.actor_user_id, 1),
          sourceKey: await this.chatSourceKey!(session.userId, target.chat_session_uid), itemUid: item.record_uid,
          recordOwnerUserId: integer(item.record_owner_user_id, 1), sendAtMillis: integer(item.attach_at), text: typeof item.text === 'string' ? item.text.slice(0, 320) : '',
          selections: array(item.selections, 56).map(raw => { const selected = objectValue(raw); return { key: key(selected.key), expression: expression(selected.expression), at: integer(selected.at) } }) }
      }))
      if (signal?.aborted || `${this.runtime.config.environment}:${(await this.runtime.requireSession()).userId}` !== accountKey) throw new ArkmePluginError('reaction-account-changed', '账号已变化', false)
      return { items, after_id: result.after_id === '' ? '' : key(result.after_id), has_more: boolean(result.has_more) }
    }
    if (input.action === 'library-query') return library(result)
    if (input.action === 'history-policy-query') return { revision: integer(result.revision), locked: boolean(result.locked) }
    if (input.action === 'history-policy-set') {
      if (!['updated', 'unchanged', 'revision_conflict'].includes(String(result.outcome))) return invalid()
      const policy = objectValue(result.policy); return { outcome: result.outcome, policy: { revision: integer(policy.revision), locked: boolean(policy.locked) } }
    }
    if (input.action === 'library-set') {
      if (!['updated', 'idempotent', 'revision_conflict'].includes(String(result.outcome))) return invalid()
      return { outcome: result.outcome, library: library(result.library) }
    }
    if (input.action === 'set') {
      if (!['updated', 'unchanged', 'idempotent', 'revision_conflict'].includes(String(result.outcome))) return invalid()
      return { outcome: result.outcome, state: state(result.state) }
    }
    if (input.action === 'actors') return { user_ids: array(result.user_ids, 100).map(id => integer(id, 1)), has_more: boolean(result.has_more) }
    if (input.action === 'groups') return { items: array(result.items, 100).map(group), has_more: boolean(result.has_more) }
    if (input.action === 'history' || input.action === 'received') {
      const rows = array(result.items, 100).map(objectValue)
      const contextRows = rows.filter(item => item.restricted === false)
      const contexts = input.action === 'history' && this.historyContext
        ? await this.historyContext(contextRows.map(item => {
          const original = objectValue(item.original_message)
          return { sessionUID: String(objectValue(item.target).chat_session_uid ?? ''), senderID: integer(item.sender_user_id ?? 0), sourceKind: String(item.source_kind ?? ''),
            ...(typeof original.record_uid === 'string' && original.record_uid ? { message: { recordUID: original.record_uid, ownerUserID: integer(original.owner_user_id, 1), sendAtMillis: integer(original.send_at, 1) } } : {}),
          }
        }), signal) : []
      if (signal?.aborted || `${this.runtime.config.environment}:${(await this.runtime.requireSession()).userId}` !== accountKey) throw new ArkmePluginError('reaction-account-changed', '账号已变化', false)
      const contextByRow = new Map(contextRows.map((row, index) => [row, contexts[index]]))
      return {
      items: await Promise.all(rows.map(async item => {
        const target = objectValue(item.target)
        if (typeof target.chat_session_uid !== 'string' || typeof target.rel_uid !== 'string') return invalid()
        const targetID = createHash('sha256').update(JSON.stringify([session.userId, targetKey(target as ReactionWireTarget)])).digest('hex')
        const received = input.action === 'received' ? { actor_user_id: integer(item.actor_user_id, 1), private: boolean(item.private), ...(input.world_only && typeof target.record_uid === 'string' && this.worldReference ? { target: { id: targetID, worldRecordRef: await this.worldReference(target.record_uid) } } : {}) } : {}
        const restricted = boolean(item.restricted)
        return { ...received, ...(!restricted ? contextByRow.get(item) : {}), event_uid: key(item.event_uid), target_id: targetID, expression: expression(item.expression), active: boolean(item.active), at: integer(item.at), restricted, ...(!restricted && typeof item.source_kind === 'string' ? { source_kind: item.source_kind } : {}), ...(!restricted && typeof item.text === 'string' ? { text: item.text.slice(0, 320) } : {}) }
      })), has_more: boolean(result.has_more), ...(result.has_more ? { before_at: integer(result.before_at), before_id: key(result.before_id) } : {}),
    }
    }
    return invalid()
  }
}
