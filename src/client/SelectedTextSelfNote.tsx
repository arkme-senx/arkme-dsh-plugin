import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SelectedTextNoteQuote } from '../selected-text-note.js'
import { selectedTextNoteHeader } from '../selected-text-note.js'
import type { ArkmeSourceSendResult } from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

export function selectedTextSelfDelivery(accountKey: string, noteText: string, quote: SelectedTextNoteQuote, recordUid = crypto.randomUUID()) {
  const request = { expectedAccountKey: accountKey, recordUid, noteText: noteText.trim(), quote: { ...quote } }
  let result: ArkmeSourceSendResult | undefined
  return async (signal: AbortSignal) => {
    signal.throwIfAborted()
    if (result) return result
    const next = await callArkme<ArkmeSourceSendResult>('self-note.quote.send', request, signal)
    if (next.itemUid !== recordUid || next.localState !== 'synced') throw new Error('发送结果待核对，请使用原内容重试')
    result = next
    return result
  }
}

/** Shared by every selected-text surface, including the native Harness frame. */
export function SelectedTextSelfNoteDialog({ quote, accountKey, signal, onClose, onSent, getViewport }: {
  quote: SelectedTextNoteQuote; accountKey: string; signal: AbortSignal; onClose(): void; onSent(): void
  getViewport?: (() => { left: number; right: number; top: number; bottom: number }) | undefined
}) {
  const [value, setValue] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [frozen, setFrozen] = useState(false)
  const saving = useRef(false), delivery = useRef<ReturnType<typeof selectedTextSelfDelivery>>(), panel = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<ReturnType<NonNullable<typeof getViewport>>>()
  useLayoutEffect(() => {
    if (!getViewport) return
    const measure = () => setViewport(getViewport())
    measure(); window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [getViewport])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector('textarea')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const send = async () => {
    if (saving.current || !value.trim() || signal.aborted) return
    saving.current = true; setBusy(true); setError(''); setFrozen(true)
    delivery.current ??= selectedTextSelfDelivery(accountKey, value, quote)
    try { await delivery.current(signal); if (!signal.aborted) onSent() }
    catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : '发送失败，输入已保留，请重试') }
    finally { saving.current = false; if (!signal.aborted) setBusy(false) }
  }
  return createPortal(<div style={{ position: 'fixed', inset: 0, ...(viewport ? { left: viewport.left, top: viewport.top, right: 'auto', bottom: 'auto', width: viewport.right - viewport.left, height: viewport.bottom - viewport.top } : {}), zIndex: 12010, background: '#0005', display: 'grid', placeItems: 'center' }}
    onMouseDown={e => { if (e.target === e.currentTarget && !busy && !value) onClose() }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="发给自己" style={{ width: 440, maxWidth: 'calc(100% - 32px)', maxHeight: '80vh', overflowY: 'auto', padding: 20, boxSizing: 'border-box', borderRadius: 12, background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}
      onKeyDown={e => {
        if (e.key === 'Escape' && !busy && !e.nativeEvent.isComposing) { e.stopPropagation(); onClose() }
        if (e.key === 'Tab') {
          const items = Array.from(panel.current!.querySelectorAll<HTMLElement>('textarea,button:not(:disabled)')), first = items[0], last = items.at(-1)
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
        }
      }}>
      <strong>发给自己</strong>
      <div style={{ marginTop: 14, borderLeft: `2px solid ${arkmeTheme.accent}`, padding: '6px 10px', background: arkmeTheme.extensionSource, borderRadius: 4 }}>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: arkmeTheme.secondary }}>{selectedTextNoteHeader(quote)}</div>
        <blockquote style={{ margin: '6px 0 0', maxHeight: 140, overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{quote.text}</blockquote>
      </div>
      <textarea aria-label="写下你的内容" placeholder="写下自己的思考…" rows={4} value={value} readOnly={frozen} disabled={busy} maxLength={10000} onChange={e => setValue(e.target.value)} style={{ marginTop: 12, width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 85, padding: 10, font: 'inherit', fontSize: 14, borderRadius: 8, border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.input, color: arkmeTheme.text }} />
      <p style={{ fontSize: 11, color: arkmeTheme.secondary }}>引用样式保存在本机；其他设备暂时显示完整引用文本。</p>
      {error && <p role="alert" style={{ fontSize: 12, color: arkmeTheme.danger }}>{error}</p>}
      {frozen && error && <p style={{ fontSize: 12, color: arkmeTheme.secondary }}>重试将发送原内容，避免重复创建。</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={busy} onClick={onClose} style={button}>取消</button>
        <button type="button" disabled={busy || !value.trim()} onClick={() => { void send() }} style={{ ...button, color: arkmeTheme.accent }}>{busy ? '发送中…' : frozen ? '重试发送' : '发送'}</button>
      </div>
    </div>
  </div>, document.body)
}
const button = { border: 0, borderRadius: 6, padding: '7px 12px', background: arkmeTheme.layer2, color: arkmeTheme.text, cursor: 'pointer' }
