import type { CSSProperties } from 'react'
import { arkmeEmojiTextRuns } from './arkme-emoji.js'
import { ArkmeLinkText } from './ArkmeLinkText.js'

const emojiInlineStyle: CSSProperties = { display: 'inline-block', width: 22, height: 22, objectFit: 'contain', verticalAlign: '-6px' }

export interface ArkmeVisibleTextRun {
  kind: 'text' | 'mention'
  text: string
}

export function arkmeVisibleMentionRuns(text: string): ArkmeVisibleTextRun[] {
  const runs: ArkmeVisibleTextRun[] = []
  const pattern = /(^|[\s([{（【])(@[\p{L}\p{N}_\-·]+)/gmu
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const prefix = match[1] ?? ''
    const value = match[2] ?? ''
    const start = match.index + prefix.length
    if (start > cursor) runs.push({ kind: 'text', text: text.slice(cursor, start) })
    runs.push({ kind: 'mention', text: value })
    cursor = start + value.length
  }
  if (cursor < text.length) runs.push({ kind: 'text', text: text.slice(cursor) })
  return runs.length === 0 && text !== '' ? [{ kind: 'text', text }] : runs
}

function HighlightedText({ text }: { text: string }) {
  return <>{arkmeVisibleMentionRuns(text).map((run, index) => <span
    key={`${String(index)}:${run.kind}:${run.text}`}
    style={run.kind === 'mention' ? { color: 'var(--dsw-alias-state-business-primary, #3964fe)' } : undefined}
  >{run.text}</span>)}</>
}

export function ArkmeRichText({ text, highlightMentions = false }: { text: string; highlightMentions?: boolean }) {
  const renderText = highlightMentions ? (value: string) => <HighlightedText text={value} /> : undefined
  return <>{arkmeEmojiTextRuns(text).map((run, index) => run.kind === 'emoji' && run.emoji !== undefined
    ? <img
      key={`${String(index)}:emoji:${run.emoji.id}`}
      src={run.emoji.assetUrl}
      alt={run.emoji.label}
      title={run.emoji.label}
      style={emojiInlineStyle}
      draggable={false}
      data-arkme-rich-emoji={run.emoji.id}
    />
    : <span key={`${String(index)}:text`}><ArkmeLinkText
      text={run.text}
      {...(renderText === undefined ? {} : { renderText })}
    /></span>)}</>
}
