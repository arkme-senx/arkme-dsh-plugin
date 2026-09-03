import type { CSSProperties } from 'react'
import { arkmeEmojiTextRuns } from './arkme-emoji.js'
import { ArkmeLinkText, type ArkmeLinkLabelMode, type ArkmeLinkRenderer } from './ArkmeLinkText.js'

const emojiInlineStyle: CSSProperties = { display: 'inline-block', width: 22, height: 22, objectFit: 'contain', verticalAlign: '-6px' }

export interface ArkmeVisibleTextRun {
  kind: 'text' | 'mention'
  text: string
}

export function arkmeVisibleMentionRuns(text: string): ArkmeVisibleTextRun[] {
  const runs: ArkmeVisibleTextRun[] = []
  const pattern = /(^|[\s([{（【])(@[^\s@,，.。;；:：!！?？、)\]}）】]+)/gmu
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

const mentionStyle: CSSProperties = { color: 'var(--dsw-alias-state-business-primary, #3964fe)' }

export function ArkmeMentionText({ text }: { text: string }) {
  return <>{arkmeVisibleMentionRuns(text).map((run, index) => <span
    key={`${String(index)}:${run.kind}:${run.text}`}
    style={run.kind === 'mention' ? mentionStyle : undefined}
  >{run.text}</span>)}</>
}

export function ArkmeRichText({ text, highlightMentions = false, renderLink, emojiSize, linkLabelMode = 'resolved' }: {
  text: string
  highlightMentions?: boolean
  renderLink?: ArkmeLinkRenderer
  emojiSize?: number
  linkLabelMode?: ArkmeLinkLabelMode
}) {
  const renderText = highlightMentions ? (value: string) => <ArkmeMentionText text={value} /> : undefined
  return <>{arkmeEmojiTextRuns(text).map((run, index) => run.kind === 'emoji' && run.emoji !== undefined
    ? <img
      key={`${String(index)}:emoji:${run.emoji.id}`}
      src={run.emoji.assetUrl}
      alt={run.emoji.label}
      title={run.emoji.label}
      style={emojiSize === undefined ? emojiInlineStyle : { ...emojiInlineStyle, width: emojiSize, height: emojiSize, verticalAlign: `${Math.round(-emojiSize * 0.27)}px` }}
      draggable={false}
      data-arkme-rich-emoji={run.emoji.id}
    />
    : <span key={`${String(index)}:text`}><ArkmeLinkText
      text={run.text}
      linkLabelMode={linkLabelMode}
      {...(renderText === undefined ? {} : { renderText })}
      {...(renderLink === undefined ? {} : { renderLink })}
    /></span>)}</>
}
