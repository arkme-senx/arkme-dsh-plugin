import { randomUUID } from 'node:crypto'
import type { ArkmeConversationArrangement, ArkmeConversationArrangementPage } from '../types.js'
import type { ArrangementService } from './arrangement-service.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

type Reference = { viewer: number; environment: string; conversation: string; uid: string; expires: number }
const invalid = () => new ArkmePluginError('conversation-arrangement-invalid', '相关安排数据已变化，请刷新重试', true, 502)
const unavailable = () => new ArkmePluginError('conversation-arrangement-unavailable', '当前服务暂不支持按对话筛选我的安排，请更新服务后重试', false, 503)

/** Read the established personal list API with an explicitly acknowledged scope. */
export class ConversationArrangementService {
  private readonly references = new Map<string, Reference>()
  constructor(private readonly runtime: ServiceRuntime, private readonly source: Pick<SourceService, 'openSourceRef'>,
    private readonly arrangement: Pick<ArrangementService, 'ownedArrangementReference'>) {}

  async read(sourceRef: string, cursor: string, relatedRef?: string, signal?: AbortSignal): Promise<ArkmeConversationArrangementPage | ArkmeConversationArrangement> {
    const session = await this.runtime.requireSession()
    const conversation = await this.source.openSourceRef(sourceRef, session.userId)
    if (!['private_chat', 'group_chat'].includes(conversation.kind)) throw new ArkmePluginError('conversation-arrangement-scope', '仅私聊和群聊支持相关安排', false, 400)
    signal?.throwIfAborted()
    const now = Date.now()
    for (const [key, value] of this.references) if (value.expires <= now || value.viewer !== session.userId || value.environment !== this.runtime.config.environment) this.references.delete(key)
    const target = relatedRef ? this.references.get(relatedRef) : undefined
    if (relatedRef && (!target || target.conversation !== conversation.ownerRef)) throw new ArkmePluginError('conversation-arrangement-expired', '安排引用已失效，请刷新列表', false, 409)
    if (typeof cursor !== 'string' || cursor.length > 1024 || (target && cursor)) throw invalid()
    let raw: Record<string, unknown>
    try {
      raw = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arrangements/list', {
        status: -1, limit: 20, chat_session_uid: conversation.ownerRef,
        ...(target ? { uids: [target.uid] } : { conversation_cursor: cursor }),
      }, session, signal, { lane: 'interactive-read', bypassCache: true })
    } catch (error) {
      if (error instanceof ArkmePluginError && [404, 405, 501].includes(error.upstreamStatus ?? 0)) throw unavailable()
      throw error
    }
    const scope = objectValue(raw.conversation_scope)
    // Old servers ignore unknown fields and return the unfiltered personal list.
    // Never expose those results or call them an empty conversation.
    if (scope.kind !== 'personal' || scope.chat_session_uid !== conversation.ownerRef || scope.user_id !== session.userId) throw unavailable()
    if (!Array.isArray(raw.list) || raw.list.length > 20 || (raw.has_more !== undefined && typeof raw.has_more !== 'boolean')
      || (raw.next_cursor !== undefined && typeof raw.next_cursor !== 'string')) throw invalid()
    const next = stringValue(raw.next_cursor)
    if (next.length > 1024 || (raw.has_more === true && (!next || next === cursor)) || (raw.has_more !== true && next)) throw invalid()
    const seen = new Set<string>()
    const items: ArkmeConversationArrangement[] = []
    for (const value of raw.list) {
      const item = objectValue(value), uid = stringValue(item.uid).trim()
      if (!uid || ![1, 2, 3].includes(Number(item.status)) || typeof item.title !== 'string' || typeof item.description !== 'string'
        || (target && uid !== target.uid) || (item.user_id !== undefined && item.user_id !== session.userId)) throw invalid()
      if (seen.has(uid)) throw invalid()
      seen.add(uid)
      const ref = relatedRef ?? `arkme-related-arrangement.${randomUUID()}`
      this.references.set(ref, { viewer: session.userId, environment: this.runtime.config.environment, conversation: conversation.ownerRef, uid, expires: now + 15 * 60_000 })
      while (this.references.size > 2048) this.references.delete(this.references.keys().next().value!)
      const arrangementRef = await this.arrangement.ownedArrangementReference(uid, session.userId)
      items.push({ id: arrangementRef, relatedRef: ref, arrangementRef, title: item.title, description: item.description,
        status: ({ 1: 'identified', 2: 'following', 3: 'completed' } as const)[Number(item.status) as 1 | 2 | 3], sources: [],
        ...(typeof item.due_at === 'number' && Number.isFinite(item.due_at) && item.due_at > 0 ? { dueAtMillis: item.due_at } : {}) })
    }
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('conversation-arrangement-account-changed', '账号已变化，请重新打开', false, 409)
    if (target) {
      if (items.length !== 1) throw new ArkmePluginError('conversation-arrangement-expired', '该安排已不在当前对话中，请刷新列表', false, 409)
      return items[0]!
    }
    return { items, hasMore: raw.has_more === true, nextCursor: next }
  }
}
