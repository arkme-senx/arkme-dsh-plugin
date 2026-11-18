import type { ArkmeRecordThought, ArkmeRecordThoughts, ArkmeThoughtDisplay } from '../record-thought-contract.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

type Target = { kind: 'owned' | 'chat'; viewerUserId: number; recordUid: string; chatSessionUid?: string; relationUid?: string; chatAccessRef?: string }
type Resolve = (sourceRef: string, actionRef: string) => Promise<Target>
const text = (value: unknown, max = 16_384): string => typeof value === 'string' ? value.slice(0, max).trim() : ''
const texts = (value: unknown, max: number): string[] => Array.isArray(value) ? value.slice(0, max).map(item => text(item)).filter(Boolean) : []

export function displayView(raw: unknown): ArkmeThoughtDisplay | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const display = objectValue(raw), meaning = objectValue(display.unified_meaning), context = objectValue(meaning.context_understanding)
  const intent = objectValue(meaning.their_intent), position = objectValue(meaning.my_position), risk = objectValue(meaning.risk_factors)
  const analysis = objectValue(display.analysis)
  const values = { context: text(context.summary) || text(analysis.context), flowDirection: text(context.flow_direction, 100), urgency: text(context.urgency, 100),
    surface: text(intent.surface), underlying: text(intent.underlying), emotion: text(objectValue(intent.emotion).primary, 200),
    expectation: text(intent.expectation), lastAction: text(position.last_action), suggestedNext: text(position.suggested_next) || text(analysis.suggest_action), tone: text(analysis.tone) }
  return { headline: text(display.headline), ...Object.fromEntries(Object.entries(values).filter(([, value]) => value)),
    warnings: texts(risk.warnings, 3), suggestions: (Array.isArray(display.suggestions) ? display.suggestions : []).slice(0, 5).flatMap(raw => {
      const group = objectValue(raw), items = texts(group.items, 3)
      return items.length ? [{ style: text(group.style_title, 200), items }] : []
    }) }
}

/** Signed message references bind both the viewer and the conversation. The owner API revalidates current visibility/version. */
export async function readChatThoughts(runtime: ServiceRuntime, expectedScope: string, sourceRef: string, input: unknown, resolve: Resolve, signal?: AbortSignal): Promise<ArkmeRecordThoughts> {
  const session = await runtime.requireSession(), scope = `${runtime.config.environment}:${session.userId}`
  const changed = () => new ArkmePluginError('chat-thought-account-changed', '账号已切换，请重新读取想法', false, 409)
  if (expectedScope !== scope) throw changed()
  if (!sourceRef || !Array.isArray(input) || input.length > 50 || input.some(ref => typeof ref !== 'string' || !ref || ref.length > 262_144))
    throw new ArkmePluginError('chat-thought-query-invalid', '想法查询的消息范围无效', false, 400)
  const targets = await Promise.all([...new Set(input as string[])].map(ref => resolve(sourceRef, ref)))
  signal?.throwIfAborted()
  if (!targets.length) return { accountScope: scope, items: [] }
  const chatSessionUid = targets[0]?.chatSessionUid, chatAccessRef = targets[0]?.chatAccessRef
  if (!chatSessionUid || targets.some(target => target.kind !== 'chat' || target.viewerUserId !== session.userId || target.chatSessionUid !== chatSessionUid || target.chatAccessRef !== chatAccessRef || !target.relationUid || !target.recordUid))
    throw new ArkmePluginError('chat-thought-query-invalid', '想法查询的消息范围无效', false, 403)
  if (`${runtime.config.environment}:${(await runtime.requireSession()).userId}` !== scope) throw changed()
  const relations = new Map(targets.map(target => [target.relationUid!, target.recordUid]))
  const result = await runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/chat-thought/list',
    { chat_session_uid: chatSessionUid, rel_uids: [...relations.keys()] }, session, signal, { lane: 'background-read', publishServiceCooldown: false, ...(chatAccessRef ? {chatAccessRef,cacheMs:0,bypassCache:true} : {}) })
  signal?.throwIfAborted()
  if (`${runtime.config.environment}:${(await runtime.requireSession()).userId}` !== scope) throw changed()
  if (!Array.isArray(result.items)) throw new ArkmePluginError('chat-thought-response-invalid', '想法暂时无法读取，请稍后重试', true)
  const items = new Map<string, ArkmeRecordThought>()
  for (const raw of result.items) {
    const row = objectValue(raw), recordUid = relations.get(text(row.rel_uid, 256)), scene = row.scene, status = row.status, generation = row.generation
    if (row.chat_session_uid !== chatSessionUid || !recordUid || ![1, 2, 3, 4, 5].includes(scene as number)
      || ![1, 2, 3, 4].includes(status as number) || !Number.isSafeInteger(generation) || (generation as number) < 1
      || row.visibility !== (scene === 2 ? 2 : 1)) continue
    const id = `${recordUid}:${String(scene)}`, previous = items.get(id)
    if (previous && previous.generation! >= (generation as number)) continue
    const display = displayView(row.display)
    items.set(id, { id, recordUid, biz: (scene as number) <= 3 ? 2 : 1, scene: scene as 1 | 2 | 3 | 4 | 5,
      visibility: scene === 2 ? 'members' : 'user', status: (['generating', 'ready', 'failed', 'invalidated'] as const)[(status as number) - 1]!,
      ...(typeof row.reply_target_ref === 'string' && row.reply_target_ref.length <= 4096 && row.reply_target_ref ? { replyTargetRef: row.reply_target_ref } : {}), generation: generation as number, content: text(row.content, 131_072), ...(display ? { display } : {}) })
  }
  return { accountScope: scope, items: [...items.values()] }
}
