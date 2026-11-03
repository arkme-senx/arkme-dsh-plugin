import { randomUUID } from 'node:crypto'
import type { ArkmeConversationArrangement, ArkmeConversationArrangementPage } from '../types.js'
import type { ArrangementService } from './arrangement-service.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

type Reference = { viewer: number; environment: string; conversation: string; uid: string; owner: number; expires: number }
const invalid = () => new ArkmePluginError('conversation-arrangement-invalid', '相关安排数据已变化，请刷新重试', true, 502)

/** Shared conversation snapshots never enter the personal arrangement cache. */
export class ConversationArrangementService {
  private readonly references = new Map<string, Reference>()
  constructor(private readonly runtime: ServiceRuntime, private readonly source: Pick<SourceService, 'openSourceRef'>,
    private readonly arrangement: Pick<ArrangementService, 'ownedArrangementReference'>) {}

  async read(sourceRef: string, cursor: string, relatedRef?: string, signal?: AbortSignal): Promise<ArkmeConversationArrangementPage | ArkmeConversationArrangement> {
    const session = await this.runtime.requireSession()
    const conversation = await this.source.openSourceRef(sourceRef, session.userId)
    if (!['private_chat', 'group_chat'].includes(conversation.kind)) throw new ArkmePluginError('conversation-arrangement-scope', '仅私聊和群聊支持相关安排', false, 400)
    const now = Date.now()
    for (const [key, value] of this.references) if (value.expires <= now || value.viewer !== session.userId || value.environment !== this.runtime.config.environment) this.references.delete(key)
    const target = relatedRef ? this.references.get(relatedRef) : undefined
    if (relatedRef && (!target || target.conversation !== conversation.ownerRef)) throw new ArkmePluginError('conversation-arrangement-expired', '安排引用已失效，请刷新列表', false, 409)
    if (typeof cursor !== 'string' || cursor.length > 1024) throw invalid()
    const raw = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      `/api/v1/arrangements/conversation/${target ? 'detail' : 'list'}`,
      { chat_session_uid: conversation.ownerRef, ...(target ? { uid: target.uid, owner_user_id: target.owner } : { cursor }) },
      session, signal, { lane: 'interactive-read', bypassCache: true },
    )
    const project = async (value: unknown): Promise<ArkmeConversationArrangement> => {
      const item = objectValue(value), uid = stringValue(item.uid), owner = Number(item.owner_user_id)
      if (!uid || !stringValue(item.id) || !Number.isSafeInteger(owner) || owner <= 0 || ![1, 2, 3].includes(Number(item.status))
        || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.can_manage !== 'boolean'
        || !Array.isArray(item.sources) || !item.sources.length || item.sources.length > 20
        || (target && (uid !== target.uid || owner !== target.owner))) throw invalid()
      const sources = item.sources.map(value => {
        const e = objectValue(value)
        if (!stringValue(e.record_uid) || !Number.isSafeInteger(e.record_owner_user_id) || Number(e.record_owner_user_id) <= 0
          || typeof e.text !== 'string' || typeof e.sender !== 'string' || !Number.isFinite(e.sent_at) || Number(e.sent_at) <= 0) throw invalid()
        return { itemUid: stringValue(e.record_uid), recordOwnerUserId: Number(e.record_owner_user_id), sender: e.sender,
          sendAtMillis: Number(e.sent_at), text: e.text }
      })
      const ref = relatedRef ?? `arkme-related-arrangement.${randomUUID()}`
      this.references.set(ref, { viewer: session.userId, environment: this.runtime.config.environment, conversation: conversation.ownerRef, uid, owner, expires: now + 15 * 60_000 })
      while (this.references.size > 2048) this.references.delete(this.references.keys().next().value!)
      const canManage = item.can_manage && owner === session.userId
      return { id: stringValue(item.id), relatedRef: ref, title: item.title, description: item.description,
        status: ({ 1: 'identified', 2: 'following', 3: 'completed' } as const)[Number(item.status) as 1 | 2 | 3], sources,
        ...(Number.isFinite(item.due_at) && Number(item.due_at) > 0 ? { dueAtMillis: Number(item.due_at) } : {}),
        ...(canManage ? { arrangementRef: await this.arrangement.ownedArrangementReference(uid, session.userId) } : {}) }
    }
    let result: ArkmeConversationArrangementPage | ArkmeConversationArrangement
    if (target) result = await project(raw)
    else {
      if (!Array.isArray(raw.items) || raw.items.length > 20 || typeof raw.has_more !== 'boolean'
        || typeof raw.next_cursor !== 'string' || raw.next_cursor.length > 1024
        || (raw.has_more && (!raw.next_cursor || raw.next_cursor === cursor))) throw invalid()
      result = { items: await Promise.all(raw.items.map(project)), hasMore: raw.has_more, nextCursor: raw.next_cursor as string }
    }
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('conversation-arrangement-account-changed', '账号已变化，请重新打开', false, 409)
    return result
  }
}
