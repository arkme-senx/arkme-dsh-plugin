import { useState } from 'react'
import type { ArkmeTimelineExtensionParent } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'

/** Quoted text is inert prose: it cannot re-mention people or execute rich content. */
export function ArkmeQuotePreview({ parent, onOpen }: { parent: ArkmeTimelineExtensionParent; onOpen?: (() => void) | undefined }) {
  const [expanded, setExpanded] = useState(false)
  const unavailable = parent.quoteState === 'unavailable'
  const text = unavailable ? '原消息已撤回或不可查看' : parent.quote?.text ?? parent.textContent
  return <div data-arkme-quote-preview style={{ minWidth: 0, borderLeft: `2px solid ${arkmeTheme.accent}`, padding: '3px 8px', background: arkmeTheme.extensionSource, borderRadius: 4, fontSize: 12, lineHeight: '18px' }}>
    <button type="button" aria-label="定位引用原文" disabled={unavailable || !onOpen} onClick={event => { event.stopPropagation(); onOpen?.() }}
      style={{ display: 'block', width: '100%', padding: 0, border: 0, textAlign: 'left', font: 'inherit', background: 'transparent', color: arkmeTheme.secondary, cursor: unavailable || !onOpen ? 'default' : 'pointer' }}>
      <span style={{ display: 'block', color: arkmeTheme.text }}>{parent.senderName}{parent.quoteState === 'edited' ? ' · 原消息已编辑' : ''}</span>
      <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: expanded ? undefined : 2, overflow: 'hidden' }}>{text}</span>
    </button>
    {!unavailable && (text.length > 90 || text.includes('\n')) && <button type="button" onClick={event => { event.stopPropagation(); setExpanded(value => !value) }}
      style={{ padding: 0, border: 0, font: 'inherit', color: arkmeTheme.tertiary, background: 'transparent', cursor: 'pointer' }}>{expanded ? '收起引用' : '展开引用'}</button>}
  </div>
}
