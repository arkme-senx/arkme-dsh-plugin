import { useLayoutEffect, useRef, useState } from 'react'
import type { ArkmeTimelineExtensionParent } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'

/** Quoted text is inert prose: it cannot re-mention people or execute rich content. */
export function ArkmeQuotePreview({ parent, onOpen, wholeMessageText }: { parent: ArkmeTimelineExtensionParent; wholeMessageText?: string | undefined; onOpen?: (() => void) | undefined }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const content = useRef<HTMLSpanElement>(null)
  const unavailable = parent.quoteState === 'unavailable'
  const text = unavailable ? '原消息已撤回或不可查看' : parent.quote?.text ?? wholeMessageText ?? ''
  useLayoutEffect(() => { setExpanded(false) }, [parent.itemUid, text])
  useLayoutEffect(() => {
    const element = content.current
    if (!element) return
    const measure = () => setOverflows(element.scrollHeight > (parseFloat(getComputedStyle(element).lineHeight) || 18) * 2 + 1)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [text, expanded])
  return <div data-arkme-quote-preview style={{ minWidth: 0, borderLeft: `2px solid ${arkmeTheme.accent}`, padding: '3px 8px', background: arkmeTheme.extensionSource, borderRadius: 4, fontSize: 12, lineHeight: '18px' }}>
    <button type="button" aria-label="定位引用原文" disabled={unavailable || !onOpen} onClick={event => { event.stopPropagation(); onOpen?.() }}
      style={{ display: 'block', width: '100%', padding: 0, border: 0, textAlign: 'left', font: 'inherit', background: 'transparent', color: arkmeTheme.secondary, cursor: unavailable || !onOpen ? 'default' : 'pointer' }}>
      <span style={{ display: 'block', color: arkmeTheme.text }}>{parent.senderName}{parent.quoteState === 'edited' ? ' · 原消息已编辑' : ''}</span>
      <span ref={content} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: expanded ? undefined : 2, overflow: 'hidden' }}>{text}</span>
    </button>
    {!unavailable && (overflows || expanded) && <button type="button" aria-expanded={expanded} onClick={event => { event.stopPropagation(); setExpanded(value => !value) }}
      style={{ padding: 0, border: 0, font: 'inherit', color: arkmeTheme.tertiary, background: 'transparent', cursor: 'pointer' }}>{expanded ? '收起引用' : '展开引用'}</button>}
  </div>
}
