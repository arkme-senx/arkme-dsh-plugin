import { forwardRef, useImperativeHandle, useRef, type CSSProperties, type TextareaHTMLAttributes } from 'react'
import type { ArkmeComposerMention } from './composer-draft-store.js'

const mentionColor = 'var(--dsw-alias-state-business-primary, #3964fe)'

const styles: Record<string, CSSProperties> = {
  host: { position: 'relative', width: '100%', minWidth: 0 },
  mirrorViewport: {
    position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
  },
  mirrorText: { minHeight: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  mention: { color: mentionColor },
  placeholder: { color: 'var(--dsw-alias-label-tertiary, #9097a1)' },
}

export interface ArkmeMentionTextRun {
  kind: 'text' | 'mention'
  text: string
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

export interface ArkmeMentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {
  mentions: readonly ArkmeComposerMention[]
  style: CSSProperties
}

export const ArkmeMentionTextarea = forwardRef<HTMLTextAreaElement, ArkmeMentionTextareaProps>(function ArkmeMentionTextarea(
  { mentions, style, value, placeholder, onScroll, ...props },
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
          : arkmeMentionTextRuns(text, mentions).map((run, index) => <span
            key={`${String(index)}:${run.kind}:${run.text}`}
            style={run.kind === 'mention' ? styles.mention : undefined}
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
