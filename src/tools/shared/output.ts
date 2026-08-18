import type {
  ArkmeCachedQueryResult, ArkmeConversationWriteResult, ArkmeUserProfileSnapshot,
} from '../../types.js'

export const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

export function formatRecordResult(label: string, result: ArkmeCachedQueryResult): string {
  const lines = [
    `${label}: count=${String(result.items.length)}, cache_complete=${String(result.cacheComplete)}, cached_at_millis=${String(result.cachedAtMillis)}`,
    '<data_from_arkme>',
  ]
  let characters = lines.join('\n').length
  let emitted = 0
  for (const item of result.items) {
    const raw = item.textContent || item.title || '[非文本快记]'
    const text = raw.length > 2_000 ? `${raw.slice(0, 2_000)}…[单条已截断]` : raw
    const state = item.localState === undefined ? '' : ` state=${item.localState}`
    const line = `- [${new Date(item.sendAtMillis).toISOString()}] uid=${item.recordUid}${state}\n${text}`
    if (characters + line.length > 20_000) break
    lines.push(line)
    characters += line.length
    emitted += 1
  }
  if (emitted === 0) lines.push('(无匹配记录)')
  if (emitted < result.items.length) lines.push(`[输出已截断：返回 ${String(emitted)}/${String(result.items.length)} 条]`)
  lines.push('</data_from_arkme>')
  return lines.join('\n')
}

export function taggedJSON(label: string, value: unknown): string {
  return `${label}\n<data_from_arkme>\n${JSON.stringify(value, undefined, 2)}\n</data_from_arkme>`
}

export function formatWriteResult(result: ArkmeConversationWriteResult): string {
  return [
    'saved_to_arkme_default_category=true',
    `record_uid=${result.recordUid}`,
    `local_state=${result.localState}`,
    `remote_status=${String(result.status)}`,
    ...(result.error === undefined ? [] : [`remote_sync_error=${JSON.stringify(result.error)}`]),
  ].join('\n')
}

export function formatProfileResult(snapshot: ArkmeUserProfileSnapshot): string {
  return [
    `Arkme 个人资料: cached_at_millis=${String(snapshot.cachedAtMillis)}, revision=${String(snapshot.revision)}`,
    '<data_from_arkme_profile>',
    JSON.stringify(snapshot.profile, undefined, 2),
    '</data_from_arkme_profile>',
  ].join('\n')
}
