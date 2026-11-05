import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { ArkoTimelineCacheStore } from '../arko-timeline-cache-store.js'
import type { ArkmeArkoInteractionQuery, ArkmeArkoInteractionPage, ArkmeArkoInteractionTarget, ArkmeArkoTimelineCache, ArkmeArkoInteraction } from '../arko-timeline-contract.js'
import type { ArkmeSourceItem } from '../types.js'
import { displayView } from './chat-thought-service.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
import type { SourceService } from './source-service.js'
import { recordOwnerId } from '../record-owner-id.js'
const invalid = () => new ArkmePluginError('arko-interaction-unavailable', '互动已不可查看，请刷新后重试', false, 404)
const prefix = 'arkme-arko-interaction-v1'
const str = (value: unknown, max = 256) => typeof value === 'string' && value.length <= max ? value : ''
const idPattern = /^(?:[rc]:[a-f0-9]{24}|t:[a-f0-9]{64}|a:[0-9]{20})$/

export class ArkoTimelineService {
  private secret: Promise<string> | undefined
  private localSecret() { return this.secret ??= this.runtime.stateStore.uniqueCode().catch(error => { this.secret = undefined; throw error }) }
  private readonly codec: EncryptedReferenceCodec
  private readonly cache: ArkoTimelineCacheStore
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService) {
    this.codec = new EncryptedReferenceCodec(() => this.localSecret(), invalid)
    this.cache = new ArkoTimelineCacheStore(join(runtime.config.fileStateDirectory ?? join(homedir(), '.arkme'), 'arko-timeline'))
  }
  private scope(user: number) { return `${this.runtime.config.environment}:${user}` }
  private async check(scope: string) { if (this.scope((await this.runtime.requireSession()).userId) !== scope) throw invalid() }
  private async key(scope: string, id: string) { return createHmac('sha256', await this.localSecret()).update(`${scope}:${id}`).digest('hex') }
  private async reference(scope: string, id: string, revision?: string) { return this.codec.seal(prefix, { scope, id, revision }) }
  private async open(ref: string, scope: string): Promise<string> {
    const value = await this.codec.open(prefix, ref)
    if (value.scope !== scope || typeof value.id !== 'string' || !idPattern.test(value.id)) throw invalid()
    return value.id
  }
  async arkoTimelineCache(scope: string, value?: ArkmeArkoTimelineCache) {
    const session = await this.runtime.requireSession(); if (this.scope(session.userId) !== scope) throw invalid()
    const result = await this.cache.access(scope, value); await this.check(scope); return result
  }
  async arkoInteractions(query: ArkmeArkoInteractionQuery = {}, signal?: AbortSignal): Promise<ArkmeArkoInteractionPage> {
    const session = await this.runtime.requireSession(), scope = this.scope(session.userId)
    if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 20)
      || query.afterMillis !== undefined && (!Number.isSafeInteger(query.afterMillis) || query.afterMillis < 0)
      || query.beforeMillis !== undefined && (!Number.isSafeInteger(query.beforeMillis) || query.beforeMillis <= 0)
      || query.knownRefs && (!Array.isArray(query.knownRefs) || query.knownRefs.length > 100)
      || query.observedRefs && (!Array.isArray(query.observedRefs) || query.observedRefs.length > 400)
      || query.knownRefs && query.observedRefs) throw invalid()
    const knownRevisions: Record<string,string> = {}
    const refs=query.knownRefs ?? query.observedRefs
    const observed=refs ? await Promise.all(refs.map(async ref=>{
      const value=await this.codec.open(prefix,ref)
      if(value.scope!==scope||typeof value.id!=='string'||!idPattern.test(value.id))throw invalid()
      knownRevisions[value.id]=str(value.revision,128)
      return value.id
    })) : undefined
    if(observed && (observed.length===0||new Set(observed).size!==observed.length))throw invalid()
    const ids=query.knownRefs ? observed : undefined
    if (ids && (query.cursor || query.afterMillis || query.beforeMillis)) throw invalid()
    const wire = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/interactions/query',
      { limit: query.limit ?? 20, ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.afterMillis ? { after: query.afterMillis } : {}), ...(query.beforeMillis ? { before: query.beforeMillis } : {}), ...(ids ? { ids } : {}), ...(refs ? { known_revisions: knownRevisions } : {}) }, session, signal,
      { lane: 'background-read', bypassCache: true, cacheMs: 0, publishServiceCooldown: false })
    await this.check(scope); signal?.throwIfAborted()
    if (!Array.isArray(wire.items) || wire.items.length > (ids?.length ?? 20) || !Array.isArray(wire.removed_ids) || typeof wire.has_more !== 'boolean') throw invalid()
    const chatNames = new Map<string,string>()
    const missing = [...new Set(wire.items.map(raw => str(objectValue(raw).chat_session_uid)).filter(Boolean))]
    for (const uid of missing) { const cached = this.source.cachedChatSource(session.userId,uid); if (cached) chatNames.set(uid,cached.displayName) }
    const needed = missing.filter(uid => !chatNames.has(uid))
    if (needed.length) {
      try {
        const data = await this.runtime.authenticatedChatPost<Record<string,unknown>>('/api/v1/chats/display-snapshots', { chat_session_uids: needed }, session, signal, { lane:'background-read' })
        for (const raw of Array.isArray(data.items) ? data.items : []) { const bundle=objectValue(raw), uid=str(objectValue(bundle.session).chat_session_uid)
          if (!needed.includes(uid)) continue
          const source = await this.source.chatSourceFromBundle(bundle,session,undefined,[])
          chatNames.set(uid,source.displayName); this.source.setChatSource(session.userId,uid,source)
        }
      } catch { signal?.throwIfAborted() }
      await this.check(scope)
    }
    const items: ArkmeArkoInteraction[] = []
    for (const raw of wire.items) {
      const row = objectValue(raw), id = str(row.id, 70), at = row.occurred_at
      if (!idPattern.test(id) || !Number.isSafeInteger(at) || Number(at) <= 0 || !['record','chat'].includes(String(row.kind)) || !str(row.summary, 2000)) throw invalid()
      items.push({ interactionKey: await this.key(scope, id), interactionRef: await this.reference(scope, id, str(row.revision,128)), occurredAtMillis: Number(at),
        sourceName: chatNames.get(str(row.chat_session_uid)) || str(row.source_name, 500) || (row.kind === 'record' ? '发给自己' : '聊天'), kind: row.kind === 'record' ? 'self' : 'chat', summary: str(row.summary, 2000), suggestion: row.kind === 'chat' && row.scene === 5 })
    }
    const removedKeys: string[] = []
    for (const id of wire.removed_ids) { if (typeof id !== 'string' || !ids?.includes(id)) throw invalid(); removedKeys.push(await this.key(scope, id)) }
    const cursor = str(wire.next_cursor, 16384)
    if (wire.has_more && !cursor) throw invalid()
    const oldest = wire.oldest_scanned_at
    if (oldest !== undefined && (!Number.isSafeInteger(oldest) || Number(oldest) < 0 || ids && oldest !== 0)) throw invalid()
    return { accountScope: scope, items, removedKeys, hasMore: wire.has_more, ...(cursor ? { nextCursor: cursor } : {}),
      ...(Number(oldest) > 0 ? {oldestScannedAtMillis:Number(oldest)} : {}) }
  }
  async arkoInteractionOpen(ref: string, signal?: AbortSignal): Promise<ArkmeArkoInteractionTarget> {
    const session = await this.runtime.requireSession(), scope = this.scope(session.userId), id = await this.open(ref, scope)
    const wire = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/interactions/details', { ids: [id], limit: 1 }, session, signal,
      { lane: 'interactive-read', bypassCache: true, cacheMs: 0, publishServiceCooldown: false })
    await this.check(scope); signal?.throwIfAborted()
    const row = Array.isArray(wire.items) && wire.items.length === 1 ? objectValue(wire.items[0]) : {}
    const owner = recordOwnerId(row.record_owner_user_id)
    if (row.id !== id || !str(row.record_uid) || owner === 0 || !str(row.content, 131072)) throw invalid()
    let source: ArkmeSourceItem
    if (row.kind === 'record') source = str(row.topic_uid) ? await this.source.sourceItem({ version: 1, userId: session.userId, kind: 'topic', ownerRef: str(row.topic_uid), displayName: str(row.source_name,500) || '主题' }) : await this.source.selfTarget(signal)
    else {
      const uid = str(row.chat_session_uid)
      if (!uid) throw invalid()
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/display-snapshots', { chat_session_uids: [uid] }, session, signal)
      const bundle = (Array.isArray(data.items) ? data.items : []).map(objectValue).find(item => objectValue(item.session).chat_session_uid === uid)
      if (!bundle) throw invalid()
      source = await this.source.chatSourceFromBundle(bundle, session, undefined, [])
    }
    await this.check(scope)
    const suggestion = row.kind === 'chat' && row.scene === 5
    return { accountScope: scope, source, itemUid: String(row.record_uid), recordOwnerUserId: owner, occurredAtMillis: Number(row.occurred_at), ...(Number.isSafeInteger(row.navigation_at)&&Number(row.navigation_at)>0?{sourceAtMillis:Number(row.navigation_at)}:{}), suggestion, interactionKey: await this.key(scope, id),
      ...(id.startsWith('t:') ? { replyId: id.slice(2) } : {}),
      ...(!id.startsWith('t:') ? { thought: { id: id.startsWith('r:') ? id.slice(2) : id.startsWith('a:') ? `agent:${id.slice(2)}` : `${row.record_uid}:${row.scene}`, recordUid: String(row.record_uid), biz: row.kind==='record' ? row.scene===2 ? 2 : 1 : row.scene===1||row.scene===2||row.scene===6 ? 2 : 1, ...(row.kind==='chat'?{scene: (row.scene===6 ? 1 : row.scene) as 1 | 2 | 3 | 4 | 5}:{}), generation: Number(row.generation), ...(str(row.reply_target_ref,4096)?{replyTargetRef:str(row.reply_target_ref,4096)}:{}), visibility: row.scene===2 ? 'members' : 'user', status: 'ready', content: String(row.content), ...(displayView(row.display) ? { display: displayView(row.display)! } : {}) } } : {}),
    }
  }
}
