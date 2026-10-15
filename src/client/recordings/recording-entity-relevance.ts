import type { RecordingEntityItem, RecordingEntityOccurrenceContext } from '../../recording-entity-contract.js'

export function isRelatedEntity(item: RecordingEntityItem): boolean {
  return ['self', 'conversation', 'concerned'].includes(item.relevance ?? 'unknown')
}
export function relatedEntitiesFirst(items: RecordingEntityItem[]): RecordingEntityItem[] {
  const rank = { self: 0, concerned: 1, conversation: 2, other: 3, unknown: 4, background: 5 }
  return items.map((item, index) => ({ item, index })).sort((a, b) =>
    rank[a.item.relevance ?? 'unknown'] - rank[b.item.relevance ?? 'unknown'] || a.index - b.index).map(value => value.item)
}
export function entityRelevanceLabel(item: Pick<RecordingEntityItem, 'relevance'>): string {
  return ({ self: '你提到', conversation: '与你交流时提到', concerned: '你关注的', other: '其他提及', background: '背景内容', unknown: '来源待确认' })[item.relevance ?? 'unknown']
}
export function entityOccurrenceSourceLabel(context: RecordingEntityOccurrenceContext): string {
  if (context.soundSource === 'playback') return '播放内容'
  if (context.relevance === 'self') return '你提到'
  if (context.relevance === 'conversation') return '与你交流时提到'
  return context.soundSource === 'in_person' ? '现场提及' : '来源待确认'
}
