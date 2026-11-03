import type { ArkmeRecordThought, ArkmeRecordThoughts } from '../record-thought-contract.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

export async function readRecordThoughts(runtime: ServiceRuntime, expectedScope: string, input: unknown, signal?: AbortSignal): Promise<ArkmeRecordThoughts> {
  const session = await runtime.requireSession(), scope = `${runtime.config.environment}:${session.userId}`
  const changed = () => new ArkmePluginError('record-thought-account-changed', '账号已切换，请重新读取想法', false, 409)
  if (!expectedScope || expectedScope !== scope) throw changed()
  if (!Array.isArray(input) || input.length > 50 || input.some(uid => typeof uid !== 'string' || !uid.trim() || uid.length > 256 || /[\u0000-\u001f\u007f]/.test(uid)))
    throw new ArkmePluginError('record-thought-query-invalid', '想法查询的消息范围无效', false, 400)
  const recordUids = [...new Set((input as string[]).map(uid => uid.trim()))].sort()
  if (!recordUids.length) return { accountScope: scope, items: [] }
  const result = await runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/thought/get-private-by-ruids',
    { ruids: recordUids }, session, signal, { lane: 'background-read', publishServiceCooldown: false })
  signal?.throwIfAborted()
  const current = await runtime.requireSession()
  if (`${runtime.config.environment}:${current.userId}` !== scope) throw changed()
  if (!Array.isArray(result.thought_ls)) throw new ArkmePluginError('record-thought-response-invalid', '想法暂时无法读取，请稍后重试', true)
  const requested = new Set(recordUids), items = new Map<string, ArkmeRecordThought>()
  for (const raw of result.thought_ls) {
    const row = objectValue(raw)
    if (typeof row.record_uid !== 'string' || !requested.has(row.record_uid)
      || typeof row.id !== 'string' || !row.id || row.id.length > 256
      || typeof row.content !== 'string' || !row.content.trim() || row.content.length > 131_072
      || (row.biz !== 1 && row.biz !== 2)) continue
    const item: ArkmeRecordThought = { id: row.id, recordUid: row.record_uid, content: row.content, biz: row.biz }
    items.set(JSON.stringify([item.recordUid, item.biz, item.id]), item)
  }
  return { accountScope: scope, items: [...items.values()].sort((a, b) => a.biz - b.biz || a.id.localeCompare(b.id)) }
}
