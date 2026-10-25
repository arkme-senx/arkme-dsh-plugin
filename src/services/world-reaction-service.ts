import { createHash } from 'node:crypto'
import type { ReactionTargetRef } from '../reaction-contract.js'
import { WORLD_REACTION_CONTRACT, WORLD_REACTION_PENDING, WORLD_REACTION_PREFIX, type WorldReactionContextPage } from '../world-reaction-contract.js'
import { TimelineTokenCodec } from './timeline-token.js'
import type { ReactionWireTarget } from './reaction-service.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

type Runtime = Pick<ServiceRuntime, 'requireSession' | 'authenticatedPost' | 'config' | 'stateStore'>
function validId(value: unknown): value is string { return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 128 }
function invalid(): never { throw new ArkmePluginError('world-reactions-contract-invalid', '世界表态接口尚未完成对接，请稍后重试', false, 502) }
export function worldReactionFailure(error: unknown): never {
  if (error instanceof ArkmePluginError && [404, 405, 501].includes(error.upstreamStatus ?? error.httpStatus)) {
    throw new ArkmePluginError('world-reactions-unavailable', WORLD_REACTION_PENDING, false, 501)
  }
  throw error
}

/** No legacy fallback: group reactions must never become public by record anchor. */
export class WorldReactionService {
  constructor(private readonly runtime: Runtime, private readonly resolveRecord: (ref: string) => Promise<ReactionWireTarget>) {}
  private async codec(userId: number) {
    return new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), JSON.stringify([this.runtime.config.environment, userId]))
  }
  async prepare(accountKey: string, recordRefs: readonly string[], signal?: AbortSignal): Promise<WorldReactionContextPage> {
    const session = await this.runtime.requireSession()
    if (accountKey !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('reaction-account-changed', '账号已变化，请重新打开表态', false)
    if (!Array.isArray(recordRefs) || !recordRefs.length || recordRefs.length > 50 || new Set(recordRefs).size !== recordRefs.length) return invalid()
    const records = new Map<string, string>()
    for (const ref of recordRefs) {
      const wire = await this.resolveRecord(ref)
      if (!validId(wire.record_uid) || records.has(wire.record_uid)) return invalid()
      records.set(wire.record_uid, ref)
    }
    let response: Record<string, unknown>
    try { response = objectValue(await this.runtime.authenticatedPost(`${WORLD_REACTION_PREFIX}prepare`, { record_uids: [...records.keys()] }, session, signal)) }
    catch (error) { return worldReactionFailure(error) }
    if (response.contract !== WORLD_REACTION_CONTRACT || !Array.isArray(response.items) || response.items.length !== records.size) return invalid()
    const codec = await this.codec(session.userId)
    const page: WorldReactionContextPage = { items: [], unavailableRecordRefs: [] }
    const seen = new Set<string>()
    for (const raw of response.items) {
      const item = objectValue(raw), uid = item.record_uid
      if (!validId(uid) || !records.has(uid) || seen.has(uid) || typeof item.readable !== 'boolean') return invalid()
      seen.add(uid)
      const recordRef = records.get(uid)!
      if (!item.readable) { page.unavailableRecordRefs.push(recordRef); continue }
      if (!validId(item.context_uid) || !validId(item.content_revision) || !['published', 'unpublished'].includes(String(item.visibility))) return invalid()
      const target = { record_uid: uid, world_context_uid: item.context_uid, content_revision: item.content_revision }
      const token = codec.seal(JSON.stringify({ target, expiresAt: Date.now() + 15 * 60_000 }), 'world-reaction-context')
      const id = `world-reaction:${createHash('sha256').update(codec.seal(JSON.stringify(target), 'world-reaction-id')).digest('hex')}`
      page.items.push({ recordRef, target: { id, worldRecordRef: token }, visibility: item.visibility as 'published' | 'unpublished' })
    }
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('reaction-account-changed', '账号已变化', false)
    return page
  }
  async resolve(target: ReactionTargetRef): Promise<ReactionWireTarget> {
    if (!target.worldRecordRef || target.sourceRef || target.messageActionRef) return invalid()
    const session = await this.runtime.requireSession(), codec = await this.codec(session.userId)
    let value: Record<string, unknown>
    try { value = objectValue(JSON.parse(codec.open(target.worldRecordRef, 'world-reaction-context'))) }
    catch { throw new ArkmePluginError('world-reactions-context-expired', '世界表态引用已失效，请刷新后重试', false, 409) }
    const wire = objectValue(value.target)
    if (typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) throw new ArkmePluginError('world-reactions-context-expired', '世界表态引用已失效，请刷新后重试', false, 409)
    if (!validId(wire.record_uid) || !validId(wire.world_context_uid) || !validId(wire.content_revision) || wire.chat_session_uid || wire.rel_uid || wire.owned) return invalid()
    return { record_uid: wire.record_uid, world_context_uid: wire.world_context_uid, content_revision: wire.content_revision }
  }
}
