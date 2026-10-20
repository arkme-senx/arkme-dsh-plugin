import type { RecordingEntityItem, RecordingEntityOccurrenceContext } from '../../recording-entity-contract.js'

/** Rank complete entities, preserving every speaker's occurrences in each card. */
export function relatedEntitiesFirst(items: RecordingEntityItem[]): RecordingEntityItem[] {
  const score = (item: RecordingEntityItem): number[] => {
    const p = item.participation
    const self = p ? p.participants.some(person => person.isSelf && person.occurrenceCount > person.playbackCount) : item.relevance === 'self'
    return [self ? 1 : 0, p ? Number(p.conversationCount > 0) : Number(item.relevance === 'conversation'),
      Number(item.relevance === 'concerned'), p?.meaningfulCount ?? 0]
  }
  return items.map((item, index) => ({ item, index, score: score(item) })).sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) { const difference = b.score[i]! - a.score[i]!; if (difference) return difference }
    return a.index - b.index
  }).map(value => value.item)
}
export function entityRelevanceLabel(item: Pick<RecordingEntityItem, 'relevance'>): string {
  return ({ self: '你提到', conversation: '与你交流时提到', concerned: '你关注的', other: '其他提及', background: '背景内容', unknown: '来源待确认' })[item.relevance ?? 'unknown']
}
export function entityOccurrenceSourceLabel(context: RecordingEntityOccurrenceContext): string {
  if (context.soundSource === 'playback') return '播放内容'
  if (context.relevance === 'self') return '你提到'
  if (context.relevance === 'conversation') return '与你交流时提到'
  return context.soundSource === 'in_person' ? '现场提及' : '声源待确认'
}
