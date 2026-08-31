export type ArkmeComposerPlaceholderTarget =
  | { kind: 'record' }
  | { kind: 'private_chat'; displayName: string }
  | { kind: 'group_chat'; displayName: string; memberCount?: number }

const composerPlaceholderSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })

function composerPlaceholderLabel(value: string): string {
  const normalized = value.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ')
  const graphemes = [...composerPlaceholderSegmenter.segment(normalized)]
    .map(item => item.segment)
  return graphemes.length <= 7 ? normalized : `${graphemes.slice(0, 7).join('')}…`
}

export function arkmeComposerGroupMemberCount(
  currentMemberCount: number | undefined,
  projectedMemberCount: number | undefined,
): number | undefined {
  for (const value of [currentMemberCount, projectedMemberCount]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const count = Math.trunc(value)
    if (count > 0) return count
  }
  return undefined
}

export function arkmeComposerPlaceholderText(target: ArkmeComposerPlaceholderTarget): string {
  if (target.kind === 'record') return '记录此刻想法...'
  const label = composerPlaceholderLabel(target.displayName)
  if (target.kind === 'private_chat') return label === '' ? '记录此刻想法...' : `发消息给@${label}`
  const memberCount = arkmeComposerGroupMemberCount(target.memberCount, undefined)
  return `发消息到 ${label}${memberCount === undefined ? '' : `(${String(memberCount)}人)`}`
}
