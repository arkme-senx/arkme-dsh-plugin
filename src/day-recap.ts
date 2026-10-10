/** Small, explicit, text-only generation contract. No source handles, coordinates or attachments. */
export const DAY_RECAP_MAX_ITEMS = 24
export const DAY_RECAP_MAX_CHARS = 6000
export interface DayRecapInput {
  accountScope: string
  bucketDate: string
  timezone: string
  consent: true
  items: Array<{ id: string; time: string; kind: string; title: string; excerpt: string; scope: string }>
}
export interface DayRecapResult {
  points: Array<{ text: string; sourceIds: string[] }>
  generatedAtMillis: number
  modelName: string
}
/** Drop links and explicit coordinate pairs even when they occur in a visible text excerpt. */
export function dayRecapText(text: string, max: number): string {
  return text.replace(/https?:\/\/\S+/gi, '[链接]')
    .replace(/[-+]?\d{1,3}\.\d{3,}\s*[,，]\s*[-+]?\d{1,3}\.\d{3,}/g, '[坐标已省略]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

export function parseDayRecapInput(value: unknown): DayRecapInput {
  if (!value || typeof value !== 'object') throw new Error('小结请求无效')
  const source = value as Record<string, unknown>
  if (source.consent !== true || typeof source.accountScope !== 'string' || !source.accountScope.trim()
    || source.accountScope.length > 120 || typeof source.bucketDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.bucketDate)
    || typeof source.timezone !== 'string' || source.timezone.length > 100
    || !Array.isArray(source.items) || !source.items.length || source.items.length > DAY_RECAP_MAX_ITEMS) {
    throw new Error('请确认当天内容及 AI 使用提示后再生成小结')
  }
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: source.timezone }).format(0) } catch { throw new Error('小结时区无效') }
  const date = new Date(`${source.bucketDate}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== source.bucketDate) throw new Error('小结日期无效')
  const ids = new Set<string>()
  const items = source.items.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('小结素材无效')
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !/^a\d{1,2}$/.test(row.id) || ids.has(row.id)) throw new Error('小结来源标识无效')
    ids.add(row.id)
    const field = (key: string, limit: number) => {
      if (typeof row[key] !== 'string' || row[key].length > limit) throw new Error('小结素材过长或格式无效')
      return dayRecapText(row[key], limit)
    }
    return { id: row.id, time: field('time', 30), kind: field('kind', 20), title: field('title', 80),
      excerpt: field('excerpt', 240), scope: field('scope', 100) }
  })
  if (JSON.stringify(items).length > DAY_RECAP_MAX_CHARS) throw new Error('小结素材超出本次长度上限')
  return { accountScope: source.accountScope, bucketDate: source.bucketDate, timezone: source.timezone, consent: true, items }
}

export function parseDayRecapPoints(text: string, input: DayRecapInput): DayRecapResult['points'] {
  const invalid = () => new Error('AI 小结未返回可核验的来源，请稍后手动重试')
  let parsed: unknown
  try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw invalid() }
  const points = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).points : undefined
  if (!Array.isArray(points) || !points.length || points.length > 5) throw invalid()
  const allowed = new Set(input.items.map(item => item.id))
  return points.map(point => {
    if (!point || typeof point !== 'object' || typeof point.text !== 'string' || !point.text.trim() || point.text.length > 240
      || !Array.isArray(point.sourceIds) || !point.sourceIds.length || point.sourceIds.length > 5
      || point.sourceIds.some((id: unknown) => typeof id !== 'string' || !allowed.has(id))) throw invalid()
    return { text: dayRecapText(point.text, 240), sourceIds: [...new Set<string>(point.sourceIds)] }
  })
}
