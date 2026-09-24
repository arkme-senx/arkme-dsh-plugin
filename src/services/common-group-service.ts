import { SharedReadGroup } from '../shared-read-group.js'
import { COMMON_GROUP_PAGE_SIZE, type ArkmeCommonGroupPage, type CommonGroupRow } from '../common-groups.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
import type { SourceService } from './source-service.js'

const invalid = () => new ArkmePluginError('common-groups-response-invalid', '共同群聊响应不完整，请重试', true, 502)
export function commonGroupChanges(value: unknown, known: string[], after: string) {
  const raw = objectValue(value)
  if (!Array.isArray(raw.items) || !Array.isArray(raw.removed) || typeof raw.has_more !== 'boolean'
    || raw.items.length > COMMON_GROUP_PAGE_SIZE || raw.removed.length > COMMON_GROUP_PAGE_SIZE) throw invalid()
  const items: CommonGroupRow[] = raw.items.map(value => {
    const row = objectValue(value)
    if (typeof row.chat_session_uid !== 'string' || !row.chat_session_uid || row.chat_session_uid.length > 128
      || typeof row.title !== 'string' || row.title.length > 4096
      || !Number.isSafeInteger(row.member_count) || Number(row.member_count) < 0) throw invalid()
    return { uid: row.chat_session_uid, title: row.title, memberCount: Number(row.member_count) }
  })
  const removed = raw.removed as unknown[]
  if (removed.some(uid => typeof uid !== 'string' || !known.includes(uid))) throw invalid()
  const identities = [...items.map(row => row.uid), ...removed]
  if (new Set(identities).size !== identities.length) throw invalid()
  if (known.length) {
    if (raw.has_more || identities.length !== known.length || identities.some(uid => !known.includes(String(uid)))) throw invalid()
  } else if (removed.length || items.some((row, i) => row.uid <= (items[i-1]?.uid ?? after))) throw invalid()
  const next = raw.has_more ? raw.next_after : ''
  if (typeof next !== 'string' || (raw.has_more && (!items.length || next !== items.at(-1)?.uid || next <= after))) throw invalid()
  return { items, removed: removed as string[], next, hasMore: raw.has_more }
}

/** One business owner; SQLite details live behind CommonGroupStore. */
export class CommonGroupService {
  private readonly reads = new SharedReadGroup<void>()
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService) {}
  dispose(): void { this.reads.clear() }

  private async context(sourceRef: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') throw new ArkmePluginError('common-groups-source-invalid', '仅支持真人私聊', false, 400)
    const store = this.runtime.stateStore.commonGroups
    if (!store) throw new ArkmePluginError('common-groups-unavailable', '当前运行环境不支持共同群聊本地存储', false, 503)
    const scope = JSON.stringify([this.runtime.config.environment, this.runtime.config.chatBaseUrl, session.userId])
    signal?.throwIfAborted()
    return { session, source, store, scope, peer: source.ownerRef }
  }

  async list(sourceRef: string, options: { cursor?: string; signal?: AbortSignal } = {}): Promise<ArkmeCommonGroupPage> {
    const { session, store, scope, peer } = await this.context(sourceRef, options.signal)
    let after = ''
    if (options.cursor) {
      const cursor = await this.source.openSourceRef(options.cursor, session.userId)
      if (cursor.kind !== 'group_chat') throw new ArkmePluginError('common-groups-cursor-invalid', '分页引用无效', false, 400)
      after = cursor.ownerRef
    }
    const page = store.read(scope, peer, after)
    const items = await Promise.all(page.items.map(async row => ({
      source: { ...await this.source.sourceItem({ version: 1, userId: session.userId, kind: 'group_chat', ownerRef: row.uid, displayName: row.title || '群聊' }),
        ...(row.groupAvatar ? { groupAvatar: row.groupAvatar } : {}) },
      memberCount: row.memberCount,
    })))
    options.signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('common-groups-account-changed', '账号已切换', false, 409)
    return { items, totalCached: page.total, hasMore: page.hasMore,
      ...(page.hasMore ? { nextCursor: items.at(-1)!.source.sourceRef } : {}),
      syncedAtMillis: page.checkpoint.syncedAtMillis, revision: page.checkpoint.revision, syncHasMore: page.checkpoint.phase !== 'complete' }
  }

  /** One bounded reconciliation batch. Completion starts a fresh round on the next
   * explicit sync. No pairwise collection or group-write fanout is required. */
  async sync(sourceRef: string, signal?: AbortSignal): Promise<ArkmeCommonGroupPage> {
    const { session, source, store, scope, peer } = await this.context(sourceRef, signal)
    await this.reads.run(JSON.stringify([scope, peer]), async (workSignal, isCurrent) => {
      const checkpoint = store.read(scope, peer).checkpoint
      const phase = checkpoint.phase === 'complete' ? 'check' : checkpoint.phase
      const after = checkpoint.phase === 'complete' ? '' : checkpoint.after
      const local = phase === 'check' ? store.read(scope, peer, after) : undefined
      const known = local?.items.map(row => row.uid) ?? []
      const bundle = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/detail',
        { chat_session_uid: source.ownerRef }, session, workSignal, { lane: 'interactive-read' })
      const target = objectValue(bundle.private_counterpart).user_id
      if (!Number.isSafeInteger(target) || Number(target) <= 0 || target === session.userId) throw new ArkmePluginError('common-groups-peer-invalid', '仅支持有效的真人私聊', false, 403)
      const discoveryAfter = phase === 'discover' ? after : ''
      const value = await this.runtime.authenticatedChatPost('/api/v1/chats/common-group/query', {
        target_user_id: target, ...(known.length ? { known_group_uids: known } : { after: discoveryAfter }),
      }, session, workSignal, { lane: 'interactive-read', bypassCache: true })
      const changes = commonGroupChanges(value, known, discoveryAfter)
      const cached = new Map(store.get(scope, peer, changes.items.map(row => row.uid)).map(row => [row.uid, row]))
      const presentations = await this.source.hydrateDirectoryPage(await Promise.all(changes.items.map(async row => ({
        ...await this.source.sourceItem({ version: 1, userId: session.userId, kind: 'group_chat', ownerRef: row.uid, displayName: row.title || '群聊' }),
        ...(cached.get(row.uid)?.groupAvatar ? { groupAvatar: cached.get(row.uid)!.groupAvatar! } : {}),
      }))), workSignal)
      const items = changes.items.map((row, index) => ({ ...row,
        ...(presentations[index]?.groupAvatar ? { groupAvatar: presentations[index]!.groupAvatar! } : {}),
      }))
      workSignal.throwIfAborted()
      if (!isCurrent()) return
      const active = await this.runtime.requireSession()
      if (active.userId !== session.userId) throw new ArkmePluginError('common-groups-account-changed', '账号已切换', false, 409)
      workSignal.throwIfAborted()
      if (!isCurrent()) return
      store.apply(scope, peer, checkpoint, { items, removed: changes.removed,
        phase: known.length ? (local!.hasMore ? 'check' : 'discover') : (changes.hasMore ? 'discover' : 'complete'),
        after: known.length ? (local!.hasMore ? known.at(-1)! : '') : changes.next })
    }, signal)
    return await this.list(sourceRef, { ...(signal ? { signal } : {}) })
  }
}
