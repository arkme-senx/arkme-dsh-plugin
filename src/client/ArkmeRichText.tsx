import { Fragment, useState, type ClipboardEvent, type CSSProperties } from 'react'
import { arkmeEmojiById, type ArkmeEmoji } from './arkme-emoji.js'
import { arkmeEmojiTextRuns } from '../arkme-emoji-text.js'
import { ArkmeLinkText, type ArkmeLinkLabelMode, type ArkmeLinkRenderer } from './ArkmeLinkText.js'
import { arkmeHashTagRanges } from '../hashtag.js'
import { arkmeUi } from './ui-controller.js'

const emojiInlineStyle: CSSProperties = { display: 'inline-block', width: 22, height: 22, objectFit: 'contain', verticalAlign: '-6px' }

export interface ArkmeVisibleTextRun {
  kind: 'text' | 'mention' | 'tag'
  text: string
}

export function arkmeVisibleMentionRuns(text: string, highlightTags = true): ArkmeVisibleTextRun[] {
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
    if (run.kind !== 'text' || !highlightTags) return [run]
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

export function ArkmeMentionText({ text, interactive = true, highlightTags = true, onTagClick = tagText => { arkmeUi.showTagSearch(tagText) } }: {
  text: string
  interactive?: boolean
  highlightTags?: boolean
  onTagClick?: (tagText: string) => void
}) {
  return <>{arkmeVisibleMentionRuns(text, highlightTags).map((run, index) => run.kind === 'tag' && interactive
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
      style={run.kind === 'mention' ? mentionStyle : run.kind === 'tag' ? tagStyle : undefined}
    >{run.text}</span>)}</>
}

function ArkmeInlineEmoji({ emoji, size }: { emoji: ArkmeEmoji; size: number | string }) {
  const [failed, setFailed] = useState(false)
  return failed ? <span role="img" aria-label={emoji.label} title={emoji.label}>{emoji.unicode}</span> : <img
    src={emoji.assetUrl}
    alt={emoji.unicode}
    aria-label={emoji.label}
    title={emoji.label}
    style={{ ...emojiInlineStyle, width: size, height: size,
      verticalAlign: typeof size === 'number' ? `${Math.round(-size * 0.27)}px` : '-0.27em' }}
    draggable={false}
    onError={() => { setFailed(true) }}
    data-arkme-rich-emoji={emoji.id}
  />
}

function copyRichText(event: ClipboardEvent<HTMLSpanElement>) {
  if (event.defaultPrevented) return
  const selection = event.currentTarget.ownerDocument.getSelection()
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed
    || !event.currentTarget.contains(selection.anchorNode) || !event.currentTarget.contains(selection.focusNode)) return
  const fragment = selection.getRangeAt(0).cloneContents()
  let converted = false
  for (const img of fragment.querySelectorAll('img[data-arkme-rich-emoji]')) {
    const emoji = arkmeEmojiById[img.getAttribute('data-arkme-rich-emoji') ?? '']
    if (emoji !== undefined) {
      img.replaceWith(emoji.unicode)
      converted = true
    }
  }
  if (!converted) return
  event.clipboardData.setData('text/plain', fragment.textContent ?? '')
  const html = event.currentTarget.ownerDocument.createElement('div')
  html.append(fragment)
  event.clipboardData.setData('text/html', html.innerHTML)
  event.preventDefault()
}

export function ArkmeRichText({ text, presentation = 'body', highlightMentions = false, highlightTags = true, renderLink, emojiSize, linkLabelMode = 'resolved', onTagClick }: {
  text: string
  presentation?: 'body' | 'preview'
  highlightMentions?: boolean
  highlightTags?: boolean
  renderLink?: ArkmeLinkRenderer
  emojiSize?: number
  linkLabelMode?: ArkmeLinkLabelMode
  onTagClick?: (tagText: string) => void
}) {
  const renderText = (value: string) => arkmeEmojiTextRuns(value).map((run, index) => run.kind === 'emoji'
    ? <ArkmeInlineEmoji
      key={`${String(index)}:emoji:${run.emoji.id}`}
      emoji={arkmeEmojiById[run.emoji.id]!}
      size={emojiSize ?? (presentation === 'preview' ? '1.25em' : 22)}
    />
    : <Fragment key={`${String(index)}:text`}>{highlightMentions
      ? <ArkmeMentionText text={run.text} highlightTags={highlightTags} interactive={presentation === 'body'} {...(onTagClick === undefined ? {} : { onTagClick })} />
      : run.text}</Fragment>)
  return <span onCopy={copyRichText}><ArkmeLinkText
    text={text}
    linkLabelMode={linkLabelMode}
    renderText={renderText}
    {...(presentation === 'preview' ? { renderLink: link => link.text } : renderLink === undefined ? {} : { renderLink })}
  /></span>
}
