import type { CSSProperties } from 'react'
import { arkmeEmojiTextRuns } from './arkme-emoji.js'
import { ArkmeLinkText, type ArkmeLinkLabelMode, type ArkmeLinkRenderer } from './ArkmeLinkText.js'
import { arkmeHashTagRanges } from '../hashtag.js'
import { arkmeUi } from './ui-controller.js'

const emojiInlineStyle: CSSProperties = { display: 'inline-block', width: 22, height: 22, objectFit: 'contain', verticalAlign: '-6px' }

export interface ArkmeVisibleTextRun {
  kind: 'text' | 'mention' | 'tag'
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
  const mentionRuns = runs.length === 0 && text !== '' ? [{ kind: 'text' as const, text }] : runs
  return mentionRuns.flatMap(run => {
    if (run.kind !== 'text') return [run]
    const tagRuns: ArkmeVisibleTextRun[] = []
    let tagCursor = 0
    for (const tag of arkmeHashTagRanges(run.text)) {
      if (tag.startIndex > tagCursor) tagRuns.push({ kind: 'text', text: run.text.slice(tagCursor, tag.startIndex) })
      tagRuns.push({ kind: 'tag', text: run.text.slice(tag.startIndex, tag.startIndex + tag.length) })
      tagCursor = tag.startIndex + tag.length
    }
    if (tagCursor < run.text.length) tagRuns.push({ kind: 'text', text: run.text.slice(tagCursor) })
    return tagRuns.length === 0 ? [run] : tagRuns
  })
}

const mentionStyle: CSSProperties = { color: 'var(--dsw-alias-state-business-primary, #3964fe)' }
const tagStyle: CSSProperties = { ...mentionStyle, fontWeight: 500 }
const clickableTagStyle: CSSProperties = { ...tagStyle, cursor: 'pointer' }

export function ArkmeMentionText({ text, onTagClick = tagText => { arkmeUi.showTagSearch(tagText) } }: {
  text: string
  onTagClick?: (tagText: string) => void
}) {
  return <>{arkmeVisibleMentionRuns(text).map((run, index) => run.kind === 'tag'
    ? <span
      key={`${String(index)}:${run.kind}:${run.text}`}
      role="link"
      tabIndex={0}
      style={clickableTagStyle}
      onClick={event => { event.preventDefault(); event.stopPropagation(); onTagClick(run.text) }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault(); event.stopPropagation(); onTagClick(run.text)
      }}
    >{run.text}</span>
    : <span
      key={`${String(index)}:${run.kind}:${run.text}`}
      style={run.kind === 'mention' ? mentionStyle : undefined}
    >{run.text}</span>)}</>
}

export function ArkmeRichText({ text, highlightMentions = false, renderLink, emojiSize, linkLabelMode = 'resolved', onTagClick }: {
  text: string
  highlightMentions?: boolean
  renderLink?: ArkmeLinkRenderer
  emojiSize?: number
  linkLabelMode?: ArkmeLinkLabelMode
  onTagClick?: (tagText: string) => void
}) {
  const renderText = highlightMentions ? (value: string) => <ArkmeMentionText text={value} {...(onTagClick === undefined ? {} : { onTagClick })} /> : undefined
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
