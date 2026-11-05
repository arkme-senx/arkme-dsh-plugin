import type { ArkmeThoughtContinuation, ArkmeThoughtContinuationPage } from '../thought-continuation.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
import { recordOwnerId, type RecordOwnerId } from '../record-owner-id.js'
type Target = { kind: 'owned' | 'chat'; viewerUserId: number; recordUid: string; chatSessionUid?: string; recordOwnerUserId?: RecordOwnerId }

/** One Host owner serves UI, SDK and Tools; caller IDs cannot override its scope. */
export async function thoughtContinuations(runtime: ServiceRuntime, sourceRef: string, messageActionRef: string,
  options: { cursor?: string; retryId?: string }, resolve: () => Promise<Target>, authorizeOwned: (uid: string) => Promise<unknown>, signal?: AbortSignal): Promise<ArkmeThoughtContinuationPage> {
  if (!sourceRef.trim() || sourceRef.length > 4096 || !messageActionRef.trim() || messageActionRef.length > 262144
    || options.cursor && !/^[a-f\d]{24}$/i.test(options.cursor) || options.retryId && !/^[a-f\d]{64}$/.test(options.retryId))
    throw new ArkmePluginError('thought-continuation-invalid', 'Arko 回复目标无效', false, 400)
  const session = await runtime.requireSession(), accountScope = `${runtime.config.environment}:${session.userId}`
  const changed = () => new ArkmePluginError('record-thought-account-changed', '账号已切换，请重新读取回复', false, 409)
  const check = async () => {
    signal?.throwIfAborted()
    const current = await runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw changed()
  }
  const target = await resolve()
  const sourceOwner = target.kind === 'owned' ? session.userId : recordOwnerId(target.recordOwnerUserId)
  if (target.viewerUserId !== session.userId || target.kind === 'chat' && (!target.chatSessionUid || sourceOwner === 0)) throw changed()
  if (target.kind === 'owned') await authorizeOwned(target.recordUid)
  await check()
  const query = { kind: target.kind === 'owned' ? 'record' : 'chat', root_record_uid: target.recordUid, root_record_owner_user_id: sourceOwner,
    ...(target.kind === 'chat' ? { chat_session_uid: target.chatSessionUid } : {}), limit: 20,
    ...(options.cursor ? { before: options.cursor } : {}) }
  if (options.retryId) {
    const result = await runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/thought/replies/retry',
      { ...query, id: options.retryId }, session, signal)
    if (result.accepted !== true) throw new ArkmePluginError('thought-continuation-retry-unconfirmed', '重试结果待核对', true)
    await check()
  }
  let data: Record<string, unknown>
  try {
    data = await runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/thought/replies/list', query, session, signal,
      { lane: 'background-read', publishServiceCooldown: false })
  } catch (error) {
    await check()
    if (!options.retryId && error instanceof ArkmePluginError && error.upstreamStatus === 404)
      return { accountScope, supported: false, items: [] }
    throw error
  }
  if (target.kind === 'owned') await authorizeOwned(target.recordUid)
  await check()
  if (!Array.isArray(data.items) || data.items.length > 20 || data.next !== undefined && (typeof data.next !== 'string' || !/^[a-f\d]{24}$/i.test(data.next)))
    throw new ArkmePluginError('thought-continuation-response-invalid', 'Arko 回复暂时无法读取', true)
  const items: ArkmeThoughtContinuation[] = [], seen = new Set<string>()
  for (const raw of data.items) {
    const row = objectValue(raw)
    if (typeof row.id !== 'string' || !/^[a-f\d]{64}$/.test(row.id) || seen.has(row.id)
      || typeof row.reply_record_uid !== 'string' || !row.reply_record_uid || row.reply_record_uid.length > 256
      || !['generating', 'ready', 'failed'].includes(String(row.status)) || !['user', 'members'].includes(String(row.visibility))
      || target.kind === 'owned' && row.visibility !== 'user' || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1
      || !Number.isSafeInteger(row.created_at) || Number(row.created_at) <= 0 || typeof row.can_retry !== 'boolean'
      || row.status === 'ready' && (typeof row.content !== 'string' || !row.content.trim() || row.content.length > 32768
        || typeof row.reply_target_ref !== 'string' || !row.reply_target_ref || row.reply_target_ref.length > 4096))
      throw new ArkmePluginError('thought-continuation-response-invalid', 'Arko 回复数据无效', true)
    seen.add(row.id)
    items.push({ id: row.id, recordUid: target.recordUid, replyRecordUid: row.reply_record_uid, biz: 2,
      content: row.status === 'ready' ? row.content as string : '', status: row.status as 'generating' | 'ready' | 'failed',
      visibility: row.visibility as 'user' | 'members', generation: Number(row.generation), createdAtMillis: Number(row.created_at),
      canRetry: row.can_retry, ...(row.status === 'ready' ? { replyTargetRef: row.reply_target_ref as string } : {}),
      ...(['reply_failed', 'insufficient_balance'].includes(String(row.failure)) ? { failure: row.failure as 'reply_failed' | 'insufficient_balance' } : {}) })
  }
  return { accountScope, supported: true, items, ...(data.next ? { nextCursor: data.next as string } : {}) }
}
