import type { WorldSubscriptionIncoming, WorldSubscriptionList, WorldSubscriptionNotice, WorldSubscriptionNoticePage, WorldSubscriptionRequest, WorldSubscriptionSubject, WorldSubscriptionTarget } from '../world-subscription-contract.js'
import { recordOwnerId } from '../record-owner-id.js'
import type { ArkmeTeam, ArkmeWorldFeedItem } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { TimelineTokenCodec } from './timeline-token.js'
import { ArkmePluginError, objectValue as obj, ServiceRuntime } from './service.js'
import type { ProfileService } from './profile-service.js'

type Principal = { kind: 'person' | 'team'; id: string }
const invalid = () => new ArkmePluginError('world-subscription-invalid', '订阅数据异常，请刷新重试', true, 502)
const positive = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) <= 0) throw invalid(); return Number(v) }
const principal = (v: unknown): Principal => { const p = obj(v); if (!['person', 'team'].includes(String(p.kind)) || typeof p.id !== 'string' || !recordOwnerId(p.id)) throw invalid(); return p as unknown as Principal }
const list = (v: unknown, max = 50): Record<string, unknown>[] => { if (!Array.isArray(v) || v.length > max) throw invalid(); return v.map(obj) }
const key = (p: Principal) => `${p.kind}:${p.id}`
export interface WorldSubscriptionPorts {
  openPrivate?(userId: number, viewer: number, displayName: string, signal?: AbortSignal): Promise<import('../types.js').ArkmeOpenPrivateChatResult>
  teams(signal?: AbortSignal): Promise<ArkmeTeam[]>
  teamID(ref: string, actor: number): Promise<number | string>
  project(values: unknown[], signal?: AbortSignal): Promise<ArkmeWorldFeedItem[]>
}

/** Each operation binds its credentials, cursors and read receipts to one account. */
export class WorldSubscriptionService {
  constructor(private readonly runtime: ServiceRuntime, private readonly profiles: ProfileService, private readonly ports: WorldSubscriptionPorts) {}
  async execute(input: WorldSubscriptionRequest, signal?: AbortSignal): Promise<unknown> {
    const session = await this.runtime.requireSession(), account = `${this.runtime.config.environment}:${session.userId}`
    if (input.accountKey !== account) throw new ArkmePluginError('world-subscription-account-changed', '账号已变化，请重新打开', false, 409)
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), account)
    const post = async (path: string, body: Record<string, unknown>) => obj(await this.runtime.authenticatedWorldPost(`/api/v1/world/subscriptions/${path}`, body, session, signal, { bypassCache: true, cacheMs: 0, lane: 'interactive-read' }))
    const resolve = async (target: WorldSubscriptionTarget | WorldSubscriptionSubject): Promise<Principal> => {
      if (!target || typeof target !== 'object') throw invalid()
      if ('id' in target) return principal({ kind: target.kind, id: target.id })
      if (target.kind === 'person') return { kind: 'person', id: String(positive(target.userId)) }
      if (target.kind !== 'team' || !target.jotmoId || target.jotmoId.length > 64) throw invalid()
      const data = obj(await this.runtime.authenticatedTeamPost('/api/v1/team/world/context', { jotmo_id: target.jotmoId }, session, signal, true))
      if (data.jotmo_id !== target.jotmoId || !recordOwnerId(data.team_id)) throw invalid()
      return { kind: 'team', id: String(recordOwnerId(data.team_id)) }
    }
    let result: unknown
    switch (input.action) {
      case 'state': {
        const target = await resolve(input.target), data = await post('states', { targets: [target] }), rows = list(data.items)
        if (rows.length !== 1 || key(principal(rows[0]!.target)) !== key(target) || typeof rows[0]!.subscribed !== 'boolean') throw invalid()
        result = { subscribed: rows[0]!.subscribed }; break
      }
      case 'set': {
        if (typeof input.active !== 'boolean' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestUid)) throw invalid()
        const target = await resolve(input.target)
        const data = await post('set', { target, active: input.active, request_uid: input.requestUid })
        if (key(principal(data.target)) !== key(target) || typeof data.subscribed !== 'boolean') throw invalid()
        // A retried old command returns its receipt; read the current edge so an
        // uncertain retry cannot visually undo a newer choice on another device.
        const current = await post('states', { targets: [target] }), rows = list(current.items)
        if (rows.length !== 1 || key(principal(rows[0]!.target)) !== key(target) || typeof rows[0]!.subscribed !== 'boolean') throw invalid()
        result = { subscribed: rows[0]!.subscribed }; break
      }
      case 'query': {
        let incoming: Principal | undefined
        if (input.incoming?.kind === 'self') incoming = { kind: 'person', id: String(session.userId) }
        else if (input.incoming?.kind === 'team') incoming = { kind: 'team', id: String(await this.ports.teamID(input.incoming.teamRef, session.userId)) }
        else if (input.incoming !== undefined) throw invalid()
        const scope = incoming ? key(incoming) : 'outgoing'
        const cursor = input.cursor ? obj(JSON.parse(codec.open(input.cursor, 'world-subscriptions-page'))) : {}
        if (input.cursor && cursor.scope !== scope) throw invalid()
        const data = await post('query', { ...(incoming ? { incoming } : {}), after_id: cursor.after ?? '', limit: 30 }), rows = list(data.items)
        const people = await this.people(rows.flatMap(r => [r.subscriber_user_id, ...(principal(r.target).kind === 'person' ? [Number(principal(r.target).id)] : [])]), session, signal)
        const teams = list(data.teams)
        const items = rows.map(r => {
          if (r.subscribed !== true) throw invalid()
          const userId = positive(r.subscriber_user_id)
          return { subject: this.subject(principal(r.target), teams, people), subscriber: { userId, name: people.get(userId) ?? '即我用户' }, subscribed: true, updatedAt: Number(r.updated_at) || 0 }
        })
        if (typeof data.has_more !== 'boolean' || data.has_more && (!rows.length || typeof data.after_id !== 'string' || data.after_id === cursor.after || !/^[a-f0-9]{64}$/.test(data.after_id))) throw invalid()
        result = { items, hasMore: data.has_more, ...(data.has_more ? { nextCursor: codec.seal(JSON.stringify({ scope, after: data.after_id }), 'world-subscriptions-page') } : {}) } satisfies WorldSubscriptionList
        break
      }
      case 'notifications': {
        const teams = (await this.ports.teams(signal)).filter(t => t.currentUserRole === 'owner' || t.currentUserRole === 'admin')
        if (teams.length > 50) throw new ArkmePluginError('world-subscription-team-limit', '管理的团队过多，暂时无法合并订阅通知', false, 400)
        const ids = (await Promise.all(teams.map(t => this.ports.teamID(t.teamRef, session.userId)))).map(String).sort()
        const scope = ids.join(',')
        const cursor = input.cursor ? obj(JSON.parse(codec.open(input.cursor, 'world-subscription-notifications'))) : {}
        if (input.cursor && cursor.scope !== scope) throw new ArkmePluginError('world-subscription-scope-changed', '团队权限已变化，请刷新通知', false, 409)
        const data = await post('notifications/query', { team_ids: ids, cursor: cursor.value ?? {}, limit: 30 }), rows = list(data.items)
        const people = await this.people(rows.flatMap(r => [r.actor_user_id, ...(principal(r.target).kind === 'person' ? [Number(principal(r.target).id)] : [])]), session, signal)
        const publicRows = obj(data.publications), expected = new Set(rows.filter(r => r.kind === 'publication').map(r => String(r.publication_uid)))
        if (Object.keys(publicRows).some(uid => !expected.has(uid))) throw invalid()
        const values = Object.entries(publicRows).map(([uid, value]) => { if (obj(value).record_uid !== uid) throw invalid(); return value })
        const projected = await this.ports.project(values, signal)
        const byUID = new Map(Object.keys(publicRows).map((uid, i) => [uid, projected[i]]))
        const allowed = new Set([`person:${session.userId}`, ...ids.map(id => `team:${id}`)])
        const items: WorldSubscriptionNotice[] = rows.map(r => {
          const recipient = principal(r.scope), target = principal(r.target), actor = positive(r.actor_user_id), sequence = positive(r.sequence)
          if (!allowed.has(key(recipient)) || typeof r.id !== 'string' || !/^[a-f0-9]{64}$/.test(r.id) || !['subscriber', 'publication'].includes(String(r.kind)) || typeof r.unread !== 'boolean' || !Number.isSafeInteger(r.at) || Number(r.at) <= 0) throw invalid()
          return { id: r.id, kind: r.kind as 'subscriber' | 'publication', subject: this.subject(target, list(data.teams), people), actor: { userId: actor, name: people.get(actor) ?? '即我用户' }, at: Number(r.at), unread: r.unread, scopeKey: key(recipient), sequence, readRef: codec.seal(JSON.stringify({ scope: recipient, through: sequence }), 'world-subscription-read'), ...(byUID.get(String(r.publication_uid)) ? { publication: byUID.get(String(r.publication_uid))! } : {}) }
        })
        if (typeof data.has_more !== 'boolean' || !Number.isSafeInteger(data.unread_count) || Number(data.unread_count) < 0 || data.has_more && (!items.length || JSON.stringify(data.cursor) === JSON.stringify(cursor.value))) throw invalid()
        result = { items, unreadCount: Number(data.unread_count), hasMore: data.has_more, ...(data.has_more ? { nextCursor: codec.seal(JSON.stringify({ scope, value: data.cursor }), 'world-subscription-notifications') } : {}) } satisfies WorldSubscriptionNoticePage
        break
      }
      case 'contact': {
        const userId = positive(input.userId)
        if (!this.ports.openPrivate || typeof input.displayName !== 'string' || input.displayName.length > 512) throw invalid()
        result = await this.ports.openPrivate(userId, session.userId, input.displayName, signal); break
      }
      case 'read': {
        if (!Array.isArray(input.readRefs) || !input.readRefs.length || input.readRefs.length > 51) throw invalid()
        const byScope = new Map<string, { scope: Principal; through: number }>()
        for (const ref of input.readRefs) { const data = obj(JSON.parse(codec.open(ref, 'world-subscription-read'))), scope = principal(data.scope), through = positive(data.through); const old = byScope.get(key(scope)); if (!old || old.through < through) byScope.set(key(scope), { scope, through }) }
        await post('notifications/read', { items: [...byScope.values()] }); result = { ok: true }; break
      }
      default: throw invalid()
    }
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || input.accountKey !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('world-subscription-account-changed', '账号已变化，请重新打开', false, 409)
    return result
  }
  private async people(ids: unknown[], session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<Map<number, string>> {
    const values = [...new Set(ids.map(positive))]
    if (values.length > 100) throw invalid()
    const rows = await this.profiles.publicProfileSummariesByUserIds(values, session, signal)
    return new Map([...rows].map(([id, p]) => [id, p.displayName || '即我用户']))
  }
  private subject(p: Principal, teams: Record<string, unknown>[], people: Map<number, string>): WorldSubscriptionSubject {
    if (p.kind === 'person') { const userId = positive(Number(p.id)); return { ...p, userId, name: people.get(userId) ?? '即我用户', available: people.has(userId) } }
    const team = teams.find(t => String(t.team_id) === p.id)
    return { ...p, name: team ? String(team.name) : '团队暂不可用', available: !!team, ...(team ? { jotmoId: String(team.jotmo_id) } : {}) }
  }
}
