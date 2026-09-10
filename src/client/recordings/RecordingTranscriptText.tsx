import { Fragment } from 'react'
import type { RecordingTranscriptMatch } from './recording-transcript-search.js'
import { arkmeTheme } from '../arkme-theme.js'

export function RecordingTranscriptText({ text, matches, activeIndex }: {
  text: string
  matches: readonly (RecordingTranscriptMatch & { index: number })[]
  activeIndex: number
}) {
  const characters = Array.from(text)
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
