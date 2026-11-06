import { configurableReplyScenes, type ArkoReplyPromptBook, type ArkoReplyPromptView, type ArkoReplyPromptWrite, type ArkoReplyPromptResult, type ArkoReplyHistoryQuery, type ArkoReplyHistoryPage } from '../arko-reply-contract.js'
import { recordOwnerId } from '../record-owner-id.js'
import { objectValue, ArkmePluginError, type ServiceRuntime } from './service.js'
import type { SourceService } from './source-service.js'
import type { ChatService } from './chat-service.js'
const invalid = () => new ArkmePluginError('arko-reply-response-invalid', '回复管理暂时无法读取，请重试', true)
const validScene = (value: unknown): value is typeof configurableReplyScenes[number] => configurableReplyScenes.includes(value as typeof configurableReplyScenes[number])
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
async function account(runtime: ServiceRuntime, expected?: string) {
  const session = await runtime.requireSession(), scope = `${runtime.config.environment}:${session.userId}`
  if (expected !== undefined && scope !== expected) throw new ArkmePluginError('arko-reply-account-changed', '账号已切换，请重新读取', false, 409)
  return { session, scope, verify: async (signal?: AbortSignal) => { signal?.throwIfAborted(); const current = await runtime.requireSession(); if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('arko-reply-account-changed', '账号已切换，请重新读取', false, 409) } }
}
function promptView(raw: unknown): ArkoReplyPromptView {
  const row = objectValue(raw), official = objectValue(row.official), effective = objectValue(row.effective)
  if (!validScene(official.scene) || !text(official.body, 100_000) || !text(official.revision, 256) || !official.revision
    || !text(official.title, 256) || !text(official.protected_instructions, 4096) || !positive(official.max_body_runes)
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !(row.user_body === null || text(row.user_body, 100_000))
    || !text(effective.body, 100_000) || effective.scene !== official.scene || effective.user_revision !== row.revision || effective.official_revision !== official.revision
    || effective.body !== (row.user_body ?? official.body)) throw invalid()
  return { scene: official.scene, title: official.title, officialBody: official.body, officialRevision: official.revision, revision: Number(row.revision),
    userBody: row.user_body as string | null, effectiveBody: effective.body, protectedInstructions: official.protected_instructions, maxBodyRunes: official.max_body_runes }
}
export async function readReplyPrompts(runtime: ServiceRuntime, expected?: string, signal?: AbortSignal): Promise<ArkoReplyPromptBook> {
  const a = await account(runtime, expected)
  const result = await runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/reply-prompts/get', {}, a.session, signal)
  await a.verify(signal)
  if (!Array.isArray(result.items) || result.items.length !== configurableReplyScenes.length) throw invalid()
  const items = result.items.map(promptView)
  if (new Set(items.map(i => i.scene)).size !== configurableReplyScenes.length) throw invalid()
  return { accountScope: a.scope, items }
}
export async function writeReplyPrompt(runtime: ServiceRuntime, input: ArkoReplyPromptWrite, expected: string, reset: boolean, signal?: AbortSignal): Promise<ArkoReplyPromptResult> {
  const a = await account(runtime, expected)
  input=objectValue(input) as unknown as ArkoReplyPromptWrite
  if (!expected || !validScene(input.scene) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !text(input.baseOfficialRevision, 256) || !input.baseOfficialRevision
    || (!reset && (!text(input.body, 100_000) || !input.body.trim() || [...input.body].length > 6000))) throw new ArkmePluginError('arko-reply-prompt-invalid', '提示词内容或版本无效', false, 400)
  const result = await runtime.authenticatedIntelligentPost<Record<string, unknown>>(`/api/v1/arko/reply-prompts/${reset ? 'reset' : 'save'}`,
    { scene: input.scene, expected_revision: input.expectedRevision, base_official_revision: input.baseOfficialRevision, ...(reset ? {} : { body: input.body }) }, a.session, signal)
  await a.verify(signal)
  if (typeof result.conflict !== 'boolean') throw invalid()
  const current = promptView(result.current)
  if (current.scene !== input.scene || (!result.conflict && current.revision <= input.expectedRevision)) throw invalid()
  return { accountScope: a.scope, conflict: result.conflict, current }
}
export async function readReplyHistory(runtime: ServiceRuntime, source: SourceService, chat: ChatService, query: ArkoReplyHistoryQuery, expected?: string, signal?: AbortSignal): Promise<ArkoReplyHistoryPage> {
  query=objectValue(query) as ArkoReplyHistoryQuery
  const a = await account(runtime, expected), scene = query.scene ?? 'all', limit = query.limit ?? 50
  if (scene !== 'all' && !validScene(scene) || !positive(limit) || limit > 50 || query.cursor !== undefined && !text(query.cursor, 2048)) throw new ArkmePluginError('arko-reply-page-invalid', '回复查询范围无效', false, 400)
  const result = await runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/arko/replies/page', { scene, cursor: query.cursor ?? '', limit }, a.session, signal, { lane: 'background-read', publishServiceCooldown: false })
  await a.verify(signal)
  if (!Array.isArray(result.items) || result.items.length > limit || result.next !== undefined && !text(result.next, 2048)) throw invalid()
  const page: ArkoReplyHistoryPage = { accountScope: a.scope, items: [], ...(typeof result.next === 'string' && result.next ? { nextCursor: result.next } : {}) }
  const self = await source.selfTarget(signal), sources = new Map<string, typeof self>()
  const sessions = [...new Set(result.items.flatMap(raw => {
    const row = objectValue(raw)
    return row.source_kind === 'chat' && text(row.chat_session_uid, 256) && row.chat_session_uid ? [row.chat_session_uid] : []
  }))]
  if (sessions.length) {
    // Reuse Chat's lean, viewer-authorized display read and the existing source
    // projection. Do not replace names with generic labels or scan the directory.
    const snapshots = await runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chats/display-snapshots', { chat_session_uids: sessions }, a.session, signal,
      { lane: 'background-read', publishServiceCooldown: false })
    await a.verify(signal)
    if (!Array.isArray(snapshots.items)) throw invalid()
    for (const raw of snapshots.items) {
      const bundle = objectValue(raw), uid = objectValue(bundle.session).chat_session_uid
      if (typeof uid !== 'string' || !sessions.includes(uid) || sources.has(uid)) throw invalid()
      sources.set(uid, await source.chatSourceFromBundle(bundle, a.session, undefined, []))
    }
    if (sources.size !== sessions.length) throw invalid()
  }
  for (const raw of result.items) {
    const r = objectValue(raw)
    if (!validScene(r.scene) || !text(r.key, 300) || !r.key || !text(r.record_uid, 256) || !r.record_uid || !positive(r.source_version) || !positive(r.source_order_at) || !positive(r.navigation_at)
      || !positive(r.generation) || !text(r.content, 131_072) || !r.content.trim() || !['root', 'continuation'].includes(String(r.result_kind)) || !['record', 'chat'].includes(String(r.source_kind))) throw invalid()
    if ((r.source_kind==='record')!==r.scene.startsWith('record_')) throw invalid()
    const owner = recordOwnerId(r.source_owner_user_id), sender = recordOwnerId(r.source_sender_user_id)
    let target = self, itemUid = r.record_uid
    if (r.source_kind === 'chat') {
      if (!text(r.chat_session_uid, 256) || !r.chat_session_uid || !text(r.rel_uid, 256) || !r.rel_uid || !positive(r.seq)) throw invalid()
      const cached = sources.get(r.chat_session_uid), kind = r.scene.startsWith('direct_') ? 'private_chat' : 'group_chat'
      if (!cached || cached.kind !== kind) throw invalid()
      target = cached; itemUid = r.rel_uid
    }
    const actionRef = await chat.arkoReplyHistoryActionRef(target.sourceRef, { recordUid: r.record_uid, recordOwnerUserId: owner, senderUserId: sender,
      relationUid: r.source_kind === 'chat' ? itemUid : '', sendAtMillis: r.navigation_at, sequence: Number(r.seq ?? 0) }, signal)
    const biz = r.scene === 'record_mention' || r.scene.endsWith('_mention') ? 2 : 1
    if (r.preview !== undefined && !text(r.preview, 16_384)) throw invalid()
    page.items.push({ ...(typeof r.preview === 'string' && r.preview ? { preview: r.preview } : {}), sourceOrderAtMillis: r.source_order_at, key: r.key, scene: r.scene, resultKind: r.result_kind as 'root' | 'continuation', source: target,
      item: { itemUid, sendAtMillis: r.navigation_at, isMe: sender === recordOwnerId(a.session.userId), recordVersion: r.source_version, recordOwnerUserId: owner, messageActionRef: actionRef,
        ...(r.source_kind === 'chat' ? { timelineItemKey: await source.chatTimelineItemKey(a.session.userId, String(r.chat_session_uid), itemUid) } : {}) },
      thought: { id: r.key, recordUid: itemUid, biz, content: r.content, sourceVersion: r.source_version, generation: r.generation, status: 'ready',
        ...(typeof r.reply_target_ref === 'string' && r.reply_target_ref.length <= 4096 ? { replyTargetRef: r.reply_target_ref } : {}) } })
  }
  await a.verify(signal); return page
}
