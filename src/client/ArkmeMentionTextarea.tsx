import { forwardRef, useImperativeHandle, useRef, type CSSProperties, type TextareaHTMLAttributes } from 'react'
import type { ArkmeComposerEmoji, ArkmeComposerMention } from './composer-draft-store.js'
import { ARKME_COMPOSER_EMOJI_PLACEHOLDER } from './composer-draft-store.js'
import { arkmeEmojiById, type ArkmeEmoji } from './arkme-emoji.js'
import { arkmeHashTagRanges } from '../hashtag.js'

const mentionColor = 'var(--dsw-alias-state-business-primary, #3964fe)'

const styles: Record<string, CSSProperties> = {
  host: { position: 'relative', width: '100%', minWidth: 0 },
  mirrorViewport: {
    position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
  },
  mirrorText: { minHeight: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  mention: { color: mentionColor },
  tag: { color: mentionColor, fontWeight: 500 },
  emoji: { display: 'inline-block', width: '1em', height: '1.5em', objectFit: 'contain', verticalAlign: '-0.35em' },
  placeholder: { color: 'var(--dsw-alias-label-tertiary, #9097a1)' },
}

export interface ArkmeMentionTextRun {
  kind: 'text' | 'mention' | 'emoji' | 'tag'
  text: string
  emoji?: ArkmeEmoji
}

export function arkmeMentionTextRuns(
  text: string,
  mentions: readonly ArkmeComposerMention[],
): ArkmeMentionTextRun[] {
  const runs: ArkmeMentionTextRun[] = []
  let cursor = 0
  for (const mention of [...mentions].sort((left, right) => left.startIndex - right.startIndex)) {
    const start = mention.startIndex
    const end = start + mention.length
    if (start < cursor || start < 0 || end > text.length || text.slice(start, end) !== `@${mention.displayName}`) continue
    if (start > cursor) runs.push({ kind: 'text', text: text.slice(cursor, start) })
    runs.push({ kind: 'mention', text: text.slice(start, end) })
    cursor = end
  }
  if (cursor < text.length) runs.push({ kind: 'text', text: text.slice(cursor) })
  return runs.length === 0 && text !== '' ? [{ kind: 'text', text }] : runs
}

export function arkmeComposerTextRuns(
  text: string,
  mentions: readonly ArkmeComposerMention[],
  emojis: readonly ArkmeComposerEmoji[],
  activeHashTagStart?: number,
): ArkmeMentionTextRun[] {
  const objects: Array<
    | { kind: 'mention'; start: number; end: number }
    | { kind: 'emoji'; start: number; end: number; emoji: ArkmeEmoji }
    | { kind: 'tag'; start: number; end: number }
  > = []
  for (const mention of mentions) {
    const end = mention.startIndex + mention.length
    if (mention.startIndex < 0 || end > text.length || text.slice(mention.startIndex, end) !== `@${mention.displayName}`) continue
    objects.push({ kind: 'mention', start: mention.startIndex, end })
  }
  for (const item of emojis) {
    const emoji = arkmeEmojiById[item.emojiId]
    if (emoji === undefined || text[item.startIndex] !== ARKME_COMPOSER_EMOJI_PLACEHOLDER) continue
    objects.push({ kind: 'emoji', start: item.startIndex, end: item.startIndex + 1, emoji })
  }
  for (const tag of arkmeHashTagRanges(text)) {
    objects.push({ kind: 'tag', start: tag.startIndex, end: tag.startIndex + tag.length })
  }
  // A bare anchor is highlighted only while it is the active input fragment.
  if (activeHashTagStart !== undefined
    && (text[activeHashTagStart] === '#' || text[activeHashTagStart] === '＃')
    && !objects.some(object => object.kind === 'tag' && object.start === activeHashTagStart)) {
    objects.push({ kind: 'tag', start: activeHashTagStart, end: activeHashTagStart + 1 })
  }
  objects.sort((left, right) => left.start - right.start || left.end - right.end)
  const runs: ArkmeMentionTextRun[] = []
  let cursor = 0
  for (const object of objects) {
    if (object.start < cursor) continue
    if (object.start > cursor) runs.push({ kind: 'text', text: text.slice(cursor, object.start) })
    runs.push(object.kind === 'emoji'
      ? { kind: 'emoji', text: text.slice(object.start, object.end), emoji: object.emoji }
      : { kind: object.kind, text: text.slice(object.start, object.end) })
    cursor = object.end
  }
  if (cursor < text.length) runs.push({ kind: 'text', text: text.slice(cursor) })
  return runs.length === 0 && text !== '' ? [{ kind: 'text', text }] : runs
}

export interface ArkmeMentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {
  mentions: readonly ArkmeComposerMention[]
  emojis?: readonly ArkmeComposerEmoji[]
  style: CSSProperties
}

export const ArkmeMentionTextarea = forwardRef<HTMLTextAreaElement, ArkmeMentionTextareaProps>(function ArkmeMentionTextarea(
  { mentions, emojis = [], style, value, placeholder, onScroll, ...props },
  forwardedRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorTextRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement)
  const text = typeof value === 'string' ? value : String(value ?? '')
  const syncScroll = (target: HTMLTextAreaElement) => {
    if (mirrorTextRef.current !== null) {
      mirrorTextRef.current.style.transform = `translate(${-target.scrollLeft}px, ${-target.scrollTop}px)`
    }
  }
  return <div style={{ ...styles.host, minHeight: style.minHeight, maxHeight: style.maxHeight }}>
    <div aria-hidden style={{ ...style, ...styles.mirrorViewport, color: 'var(--dsw-alias-label-primary, #17191c)' }}>
      <div ref={mirrorTextRef} style={styles.mirrorText}>
        {text === ''
          ? <span style={styles.placeholder}>{placeholder}</span>
          : arkmeComposerTextRuns(text, mentions, emojis).map((run, index) => run.kind === 'emoji' && run.emoji !== undefined
            ? <img key={`${String(index)}:emoji:${run.emoji.id}`} src={run.emoji.assetUrl} alt={run.emoji.label} style={styles.emoji} />
            : <span
              key={`${String(index)}:${run.kind}:${run.text}`}
              style={run.kind === 'mention' ? styles.mention : run.kind === 'tag' ? styles.tag : undefined}
            >{run.text}</span>)}
        {text.endsWith('\n') && '\u200b'}
      </div>
    </div>
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      placeholder=""
      style={{ ...style, position: 'relative', zIndex: 1, color: 'transparent', WebkitTextFillColor: 'transparent' }}
      onScroll={event => {
        syncScroll(event.currentTarget)
        onScroll?.(event)
      }}
    />
  </div>
})
