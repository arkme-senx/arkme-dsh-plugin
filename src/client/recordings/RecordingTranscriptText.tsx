import { Fragment, type KeyboardEvent, type MouseEvent } from 'react'
import type { RecordingTranscriptMatch } from './recording-transcript-search.js'
import { arkmeTheme } from '../arkme-theme.js'
import { tr } from '../locale.js'

type EntityTextRange = { start: number; length: number; entityKey?: string; name?: string }

export function RecordingTranscriptText({ text, matches, activeIndex, entityRanges = [], entityRange, onEntityClick }: {
  text: string
  matches: readonly (RecordingTranscriptMatch & { index: number })[]
  activeIndex: number
  entityRanges?: readonly EntityTextRange[]
  entityRange?: EntityTextRange
  onEntityClick?(key: string): void
}) {
  const characters = Array.from(text)
  if (entityRanges.length || entityRange) {
    const ranges = [...entityRanges, ...(entityRange ? [entityRange] : [])]
    // Split at both search and entity boundaries so highlights can safely overlap.
    const bounds = [...new Set([0, characters.length, ...ranges.flatMap(range => [range.start, range.start + range.length]),
      ...matches.flatMap(match => [match.start, match.start + match.length])])].filter(value => value >= 0 && value <= characters.length).sort((a, b) => a - b)
    return <>{bounds.slice(0, -1).map((start, index) => {
      const end = bounds[index + 1]!
      const match = matches.find(value => value.start <= start && value.start + value.length >= end)
      const entity = ranges.some(range => start >= range.start && end <= range.start + range.length)
      const selected = entityRange && start >= entityRange.start && end <= entityRange.start + entityRange.length
      const link = selected && entityRange.entityKey ? entityRange : entityRanges.find(range => range.entityKey && start >= range.start && end <= range.start + range.length)
      const activate = link?.entityKey && onEntityClick ? () => onEntityClick(link.entityKey!) : undefined
      const content = characters.slice(start, end).join('')
      const marked = entity ? <span data-recording-entity-underline data-recording-entity-highlight={selected || undefined}
        {...(activate ? {
          role: 'button', tabIndex: 0, 'data-recording-entity-key': link!.entityKey,
          'aria-label': tr('查看实体 {name}', { name: link!.name ?? content }),
          onClick: (event: MouseEvent) => { event.stopPropagation(); activate() },
          onDoubleClick: (event: MouseEvent) => event.stopPropagation(),
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); activate() }
          },
        } : {})} style={{
        ...(activate ? { cursor: 'pointer', borderRadius: 2 } : {}),
        textDecoration: 'underline', textDecorationThickness: selected ? 2 : 1, textUnderlineOffset: 3,
        ...(selected ? { background: arkmeTheme.infoSoft, boxShadow: `0 0 0 1px ${arkmeTheme.accent}`, borderRadius: 2 } : {}),
      }}>{content}</span> : content
      return match ? <mark key={start} data-recording-match={match.index} style={{ background: arkmeTheme.warningSoft, color: 'inherit', outline: match.index === activeIndex ? `1px solid ${arkmeTheme.warning}` : undefined }}>{marked}</mark> : <Fragment key={start}>{marked}</Fragment>
    })}</>
  }
  let cursor = 0
  const parts = matches.map(match => {
    const prefix = characters.slice(cursor, match.start).join('')
    cursor = match.start + match.length
    return <Fragment key={match.start}>{prefix}<mark
      data-recording-match={match.index}
      style={{ background: arkmeTheme.warningSoft, color: 'inherit', outline: match.index === activeIndex ? `1px solid ${arkmeTheme.warning}` : undefined }}
    >{characters.slice(match.start, cursor).join('')}</mark></Fragment>
  })
  return <>{parts}{characters.slice(cursor).join('')}</>
}
