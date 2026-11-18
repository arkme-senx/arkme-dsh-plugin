import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import type { SelectedTextNotePresentation } from '../selected-text-note.js'
import { tr,useArkmeLocale } from './locale.js'
import { ExcerptOriginal } from './ExcerptOriginal.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeTheme } from './arkme-theme.js'

/** Keep DOM prose in exactly the persisted order so selection anchors and edits remain correct. */
export function SelectedTextSelfNoteContent({ value, detail = false, recordUid, sourceRef, messageActionRef, contentRef }: {
  value: SelectedTextNotePresentation
  detail?: boolean
  recordUid?: string
  sourceRef?: string
  messageActionRef?: string
  contentRef?: Ref<HTMLDivElement>
}) {
  useArkmeLocale()
  const [expanded, setExpanded] = useState(detail)
  const prose = useRef<HTMLDivElement>(null), [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const element = prose.current
    if (!element) return
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure); observer.observe(element)
    return () => observer.disconnect()
  }, [value.quote.text, expanded])
  const renderExcerpt = (originalAction?: ReactNode) => <div ref={contentRef} data-arkme-self-note-quote style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
    <div style={{ borderLeft: `2px solid ${arkmeTheme.accent}`, padding: '4px 9px', borderRadius: 4, background: arkmeTheme.extensionSource, fontSize: 12, lineHeight: '18px' }}>
      <div data-arkme-quote-prose style={{ color: arkmeTheme.secondary, whiteSpace: 'pre-wrap' }}>{value.header}</div>
      <div ref={prose} data-arkme-quote-prose style={{ marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: expanded ? undefined : 2, overflow: 'hidden' }}><ArkmeRichText text={value.quote.text} linkLabelMode="raw" /></div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
        {(clipped || expanded || value.quote.text.length > 90 || value.quote.text.includes('\n')) && <button type="button" onClick={e => { e.stopPropagation(); setExpanded(v => !v) }} style={{ padding: 0, border: 0, font: 'inherit', color: arkmeTheme.tertiary, background: 'transparent', cursor: 'pointer' }}>{tr(expanded ? '收起引用' : '展开引用')}</button>}
        {originalAction}
      </div>
    </div>
    {value.noteText && <div data-arkme-quote-prose style={{ color: arkmeTheme.secondary, fontSize: 11 }}>{tr(value.kind === 'forward' ? '附言' : '我的笔记')}</div>}
    {value.noteText && <div data-arkme-quote-prose style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><ArkmeRichText text={value.noteText} linkLabelMode="raw" /></div>}
  </div>
  // Keep the reading pane outside the registered message's DOM range. A native
  // selection from the quote to the comment cannot include the original.
  if (value.storage === 'cloud' && value.quote.source && recordUid) {
    return <ExcerptOriginal recordUid={recordUid} renderExcerpt={renderExcerpt}
      {...(sourceRef && messageActionRef ? { sourceRef, messageActionRef } : {})} />
  }
  return renderExcerpt()
}
