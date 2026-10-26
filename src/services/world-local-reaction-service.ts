import { createHash } from 'node:crypto'
import type { ReactionRequest, ReactionTargetRef } from '../reaction-contract.js'
import { TimelineTokenCodec } from './timeline-token.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

type Runtime = Pick<ServiceRuntime, 'config' | 'stateStore' | 'requireSession'>
async function codec(runtime: Runtime, userId: number) { return new TimelineTokenCodec(await runtime.stateStore.uniqueCode(), JSON.stringify([runtime.config.environment, userId])) }
export async function localWorldReactionTarget(runtime: Runtime, userId: number, recordUid: string, digest: string): Promise<ReactionTargetRef> {
  const envelope = await codec(runtime, userId)
  const ref = envelope.seal(JSON.stringify({ recordUid, digest }), 'world-local-reaction')
  return { id: `world-local:${createHash('sha256').update(ref).digest('hex')}`, worldRecordRef: ref }
}

/** No HTTP dependencies. These are personal annotations, never public reactions or a cloud outbox. */
export class WorldLocalReactionService {
  constructor(private readonly runtime: Runtime) {}
  async request(input: ReactionRequest, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession(), scope = `${this.runtime.config.environment}:${session.userId}`
    if (input.accountKey !== scope) throw new ArkmePluginError('reaction-account-changed', '账号已变化，请重新打开表态', false)
    const store = this.runtime.stateStore.worldReactions
    if (!store) throw new ArkmePluginError('world-local-reactions-storage-unavailable', '本机表态存储暂不可用，请重试', true, 503)
    const envelope = await codec(this.runtime, session.userId)
    const resolve = (target: ReactionTargetRef) => {
      try {
        if (!target?.id || !target.worldRecordRef || target.sourceRef || target.messageActionRef) throw new Error('target')
        const value = objectValue(JSON.parse(envelope.open(target.worldRecordRef, 'world-local-reaction')))
        if (typeof value.recordUid !== 'string' || !value.recordUid.trim() || value.recordUid.length > 128 || typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest)) throw new Error('scope')
        return createHash('sha256').update(JSON.stringify([value.recordUid, value.digest])).digest('hex')
      } catch { throw new ArkmePluginError('world-local-reactions-target-invalid', '本机表态引用无效，请刷新世界后重试', false, 403) }
    }
    const assertCurrent = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.requireSession()
      if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('reaction-account-changed', '账号已变化，请重新打开表态', false)
      signal?.throwIfAborted()
    }
    await assertCurrent()
    if (input.action === 'library-query') return store.library(scope)
    if (input.action === 'library-set') return store.saveLibrary(scope, input)
    if (input.action === 'query') {
      if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 50 || new Set(input.targets.map(t => t.id)).size !== input.targets.length) throw new ArkmePluginError('world-local-reactions-query-invalid', '本机表态查询数量无效', false)
      return { items: input.targets.map(target => {
        const mine = store.read(scope, resolve(target))
        return { target_id: target.id, mine, groups: mine.selections.map(item => ({ key: item.key, expression: item.expression, count: 1, actors: [{ userId: session.userId, displayName: '我' }] })), actors_visible: true, private: false, has_more: false }
      }) }
    }
    if (input.action === 'set') return store.set(scope, resolve(input.target), input)
    if (input.action === 'groups' || input.action === 'actors') {
      const state = store.read(scope, resolve(input.target))
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new ArkmePluginError('world-local-reactions-query-invalid', '本机表态查询数量无效', false)
      if (input.action === 'actors') return { items: state.selections.some(item => item.key === input.key) && session.userId > input.after_user_id ? [{ userId: session.userId, displayName: '我' }] : [], has_more: false }
      const groups = state.selections.filter(item => item.key > input.after_key).sort((a, b) => a.key.localeCompare(b.key))
      return { items: groups.slice(0, input.limit).map(item => ({ key: item.key, expression: item.expression, count: 1, actors: [{ userId: session.userId, displayName: '我' }] })), has_more: groups.length > input.limit }
    }
    throw new ArkmePluginError('world-local-reactions-operation-invalid', '不支持的本机表态操作', false)
  }
}
