import { useLayoutEffect, useRef, useState } from 'react'
import type { SelectedTextNotePresentation } from '../selected-text-note.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeTheme } from './arkme-theme.js'

/** Keep DOM prose in exactly the persisted order so selection anchors and edits remain correct. */
export function SelectedTextSelfNoteContent({ value, detail = false }: { value: SelectedTextNotePresentation; detail?: boolean }) {
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
  return <div data-arkme-self-note-quote style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
    <div style={{ borderLeft: `2px solid ${arkmeTheme.accent}`, padding: '4px 9px', borderRadius: 4, background: arkmeTheme.extensionSource, fontSize: 12, lineHeight: '18px' }}>
      <div data-arkme-quote-prose style={{ color: arkmeTheme.secondary, whiteSpace: 'pre-wrap' }}>{value.header}</div>
      <div ref={prose} data-arkme-quote-prose style={{ marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: expanded ? undefined : 2, overflow: 'hidden' }}><ArkmeRichText text={value.quote.text} linkLabelMode="raw" /></div>
      {(clipped || expanded || value.quote.text.length > 90 || value.quote.text.includes('\n')) && <button type="button" onClick={e => { e.stopPropagation(); setExpanded(v => !v) }} style={{ padding: 0, border: 0, font: 'inherit', color: arkmeTheme.tertiary, background: 'transparent', cursor: 'pointer' }}>{expanded ? '收起引用' : '展开引用'}</button>}
    </div>
    {(value.kind !== 'forward' || value.noteText) && <div data-arkme-quote-prose style={{ color: arkmeTheme.secondary, fontSize: 11 }}>{value.kind === 'forward' ? '附言' : '我的笔记'}</div>}
    {(value.kind !== 'forward' || value.noteText) && <div data-arkme-quote-prose style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><ArkmeRichText text={value.noteText} linkLabelMode="raw" /></div>}
  </div>
}
