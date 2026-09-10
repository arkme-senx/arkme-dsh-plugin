import { Fragment, useState, type ClipboardEvent, type CSSProperties } from 'react'
import { arkmeEmojiById, type ArkmeEmoji } from './arkme-emoji.js'
import { arkmeEmojiTextRuns } from '../arkme-emoji-text.js'
import type { ArkmeTimelineMentionTarget } from '../types.js'
import { ArkmeLinkText, type ArkmeLinkLabelMode, type ArkmeLinkRenderer } from './ArkmeLinkText.js'
import { arkmeHashTagRanges } from '../hashtag.js'
import { arkmeUi } from './ui-controller.js'

const emojiInlineStyle: CSSProperties = { display: 'inline-block', width: 22, height: 22, objectFit: 'contain', verticalAlign: '-6px' }

export interface ArkmeVisibleTextRun {
  kind: 'text' | 'mention' | 'tag'
  text: string
  mentionTarget?: ArkmeTimelineMentionTarget
}

const visibleMentionPattern = /@[^\s@,，.。;；:：!！?？、]+/gmu
const emailLocalPartPattern = /[A-Za-z0-9._%+-]/u
const asciiEmailPartPattern = /^[A-Za-z0-9._%+-]+$/u
const asciiDomainPartPattern = /^[A-Za-z0-9-]+$/u

function arkmeLooksLikeEmailAddress(text: string, start: number, end: number): boolean {
  const previous = start > 0 ? text.charAt(start - 1) : ''
  const next = end < text.length ? text.charAt(end) : ''
  if (previous === '' || next !== '.' || !emailLocalPartPattern.test(previous)) return false
  let localStart = start - 1
  while (localStart > 0 && emailLocalPartPattern.test(text.charAt(localStart - 1))) localStart -= 1
  const localPart = text.slice(localStart, start)
  const domainPart = text.slice(start + 1, end)
  return asciiEmailPartPattern.test(localPart) && asciiDomainPartPattern.test(domainPart)
}

function normalizedVisibleMentionTargets(
  text: string,
  mentionTargets?: readonly ArkmeTimelineMentionTarget[],
): ArkmeTimelineMentionTarget[] {
  const targets = (mentionTargets ?? []).flatMap(target => {
    const startIndex = Math.trunc(target.startIndex)
    const length = Math.trunc(target.length)
    if (startIndex < 0 || length < 2 || startIndex + length > text.length) return []
    const mentionText = text.slice(startIndex, startIndex + length)
    if (!mentionText.startsWith('@')) return []
    return [{ ...target, startIndex, length }]
  }).sort((left, right) => left.startIndex - right.startIndex)
  const normalized: ArkmeTimelineMentionTarget[] = []
  for (const target of targets) {
    const previous = normalized.at(-1)
    if (previous !== undefined && previous.startIndex + previous.length > target.startIndex) continue
    normalized.push(target)
  }
  return normalized
}

function shiftedVisibleMentionTargets(
  mentionTargets: readonly ArkmeTimelineMentionTarget[] | undefined,
  offset: number,
  length: number,
): ArkmeTimelineMentionTarget[] | undefined {
  if (mentionTargets === undefined || mentionTargets.length === 0) return undefined
  const end = offset + length
  const shifted = mentionTargets.flatMap(target => {
    const startIndex = Math.trunc(target.startIndex)
    const targetEnd = startIndex + Math.trunc(target.length)
    return startIndex >= offset && targetEnd <= end
      ? [{ ...target, startIndex: startIndex - offset }]
      : []
  })
  return shifted.length === 0 ? undefined : shifted
}

export function arkmeVisibleMentionRuns(
  text: string,
  highlightTags = true,
  mentionTargets?: readonly ArkmeTimelineMentionTarget[],
): ArkmeVisibleTextRun[] {
  const runs: ArkmeVisibleTextRun[] = []
  let cursor = 0
  const explicitMentions = normalizedVisibleMentionTargets(text, mentionTargets)
  if (explicitMentions.length > 0) {
    for (const mention of explicitMentions) {
      const start = mention.startIndex
      const end = start + mention.length
      if (start > cursor) runs.push({ kind: 'text', text: text.slice(cursor, start) })
      runs.push({ kind: 'mention', text: text.slice(start, end), mentionTarget: mention })
      cursor = end
    }
  } else {
    for (const match of text.matchAll(visibleMentionPattern)) {
      const value = match[0] ?? ''
      const start = match.index ?? 0
      const end = start + value.length
      if (arkmeLooksLikeEmailAddress(text, start, end)) continue
      if (start > cursor) runs.push({ kind: 'text', text: text.slice(cursor, start) })
      runs.push({ kind: 'mention', text: value })
      cursor = end
    }
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
const clickableMentionStyle: CSSProperties = { ...mentionStyle, cursor: 'pointer' }
const tagStyle: CSSProperties = { ...mentionStyle, fontWeight: 500 }
const clickableTagStyle: CSSProperties = { ...tagStyle, cursor: 'pointer' }

export type ArkmeMentionClickHandler = (mentionText: string, mentionTarget?: ArkmeTimelineMentionTarget) => void
export type ArkmeMentionClickPredicate = (mentionText: string, mentionTarget?: ArkmeTimelineMentionTarget) => boolean

export function ArkmeMentionText({
  text,
  mentionTargets,
  interactive = true,
  highlightTags = true,
  onTagClick = tagText => { arkmeUi.showTagSearch(tagText) },
  onMentionClick,
  isMentionClickable,
}: {
  text: string
  mentionTargets?: readonly ArkmeTimelineMentionTarget[]
  interactive?: boolean
  highlightTags?: boolean
  onTagClick?: (tagText: string) => void
  onMentionClick?: ArkmeMentionClickHandler
  isMentionClickable?: ArkmeMentionClickPredicate
}) {
  return <>{arkmeVisibleMentionRuns(text, highlightTags, mentionTargets).map((run, index) => {
    const canClickMention = run.kind === 'mention' && interactive && onMentionClick !== undefined
      && (isMentionClickable?.(run.text, run.mentionTarget) ?? true)
    const mentionClick = canClickMention ? onMentionClick : undefined
    return run.kind === 'tag' && interactive
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
      : mentionClick !== undefined
        ? <span
          key={`${String(index)}:${run.kind}:${run.text}`}
          role="link"
          tabIndex={0}
          aria-label={`查看 ${run.text}`}
          style={clickableMentionStyle}
          onClick={event => { event.preventDefault(); event.stopPropagation(); mentionClick(run.text, run.mentionTarget) }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault(); event.stopPropagation(); mentionClick(run.text, run.mentionTarget)
          }}
        >{run.text}</span>
        : <span
          key={`${String(index)}:${run.kind}:${run.text}`}
          style={run.kind === 'mention' ? mentionStyle : run.kind === 'tag' ? tagStyle : undefined}
        >{run.text}</span>
  })}</>
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

export function ArkmeRichText({
  text,
  presentation = 'body',
  highlightMentions = false,
  highlightTags = true,
  renderLink,
  emojiSize,
  linkLabelMode = 'resolved',
  mentionTargets,
  onTagClick,
  onMentionClick,
  isMentionClickable,
}: {
  text: string
  presentation?: 'body' | 'preview'
  highlightMentions?: boolean
  highlightTags?: boolean
  renderLink?: ArkmeLinkRenderer
  emojiSize?: number
  linkLabelMode?: ArkmeLinkLabelMode
  mentionTargets?: readonly ArkmeTimelineMentionTarget[]
  onTagClick?: (tagText: string) => void
  onMentionClick?: ArkmeMentionClickHandler
  isMentionClickable?: ArkmeMentionClickPredicate
}) {
  const renderText = (value: string, startIndex = 0) => {
    let cursor = 0
    return arkmeEmojiTextRuns(value).map((run, index) => {
      const runStart = cursor
      cursor += run.text.length
      const runMentionTargets = shiftedVisibleMentionTargets(mentionTargets, startIndex + runStart, run.text.length)
      return run.kind === 'emoji'
        ? <ArkmeInlineEmoji
          key={`${String(index)}:emoji:${run.emoji.id}`}
          emoji={arkmeEmojiById[run.emoji.id]!}
          size={emojiSize ?? (presentation === 'preview' ? '1.25em' : 22)}
        />
        : <Fragment key={`${String(index)}:text`}>{highlightMentions
          ? <ArkmeMentionText
            text={run.text}
            {...(runMentionTargets === undefined ? {} : { mentionTargets: runMentionTargets })}
            highlightTags={highlightTags}
            interactive={presentation === 'body'}
            {...(onTagClick === undefined ? {} : { onTagClick })}
            {...(onMentionClick === undefined ? {} : { onMentionClick })}
            {...(isMentionClickable === undefined ? {} : { isMentionClickable })}
          />
          : run.text}</Fragment>
    })
  }
  return <span onCopy={copyRichText}><ArkmeLinkText
    text={text}
    linkLabelMode={linkLabelMode}
    renderText={renderText}
    {...(presentation === 'preview' ? { renderLink: link => link.text } : renderLink === undefined ? {} : { renderLink })}
  /></span>
}
