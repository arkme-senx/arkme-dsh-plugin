import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeMessageQuote } from '../message-quote.js'
import type { MessageSelectionTarget } from './ArkmeMessageTextSelection.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export type PrepareSelectedTextReplace = (target: MessageSelectionTarget, quote: ArkmeMessageQuote, signal: AbortSignal) => Promise<{ save(value: string): Promise<void> }>

export function ArkmeSelectedTextReplace({ target, quote, rect, prepare, onClose }: {
  target: MessageSelectionTarget; quote: ArkmeMessageQuote; rect: DOMRect; prepare: PrepareSelectedTextReplace; onClose(): void
}) {
  const [value, setValue] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [session, setSession] = useState<Awaited<ReturnType<PrepareSelectedTextReplace>>>()
  const [attempt, setAttempt] = useState(0)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), saving = useRef(false)
  const initial = useRef({ target, quote, prepare })
  useEffect(() => {
    const controller = new AbortController()
    setSession(undefined); setError('')
    void initial.current.prepare(initial.current.target, initial.current.quote, controller.signal)
      .then(result => { if (!controller.signal.aborted) setSession(result) })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '读取原文失败') })
    input.current?.focus({ preventScroll: true })
    return () => controller.abort()
  }, [attempt])
  useEffect(() => {
    const down = (event: MouseEvent) => { if (!saving.current && event.target instanceof Node && !root.current?.contains(event.target)) onClose() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [onClose])
  useLayoutEffect(() => {
    const place = () => {
      const box = root.current?.getBoundingClientRect()
      if (!box) return
      setPosition({ left: Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.right - box.width)),
        top: Math.max(8, Math.min(window.innerHeight - box.height - 8, rect.bottom + 8)) })
    }
    place(); window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [rect, error, session])
  const save = async () => {
    if (!session || saving.current) return
    saving.current = true; setBusy(true); setError('')
    try { await session.save(value); onClose() }
    catch (caught) { setError(caught instanceof Error ? caught.message : '替换失败，输入已保留，请重试') }
    finally { saving.current = false; setBusy(false) }
  }
  return createPortal(<div ref={root} role="toolbar" data-arkme-text-selection-toolbar aria-label={tr('替换选中文字')}
    onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    style={{ position: 'fixed', ...position, zIndex: 12000, width: 300, maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box', padding: 12,
      border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.menu, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}>
    <form aria-label={tr('替换选中文字')} onSubmit={event => { event.preventDefault(); void save() }}
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); if (!busy) onClose() } }}>
      <div style={{ fontSize: 12, color: arkmeTheme.secondary, maxHeight: 62, overflowY: 'auto', overflowWrap: 'anywhere', marginBottom: 8 }}>原文：{quote.text}</div>
      <textarea ref={input} aria-label={tr('替换为')} placeholder={tr('替换为…')} value={value} disabled={busy} rows={2}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void save() } }}
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 58, maxHeight: 160, border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, padding: 8, font: 'inherit', fontSize: 13, background: arkmeTheme.input, color: arkmeTheme.text }} />
      {!session && !error && <div role="status" style={{ fontSize: 12, paddingTop: 8, color: arkmeTheme.secondary }}>{tr('正在读取原文…')}</div>}
      {error && <div role="alert" style={{ fontSize: 12, paddingTop: 8, color: arkmeTheme.danger }}>{error}{!session && <button type="button" onClick={() => setAttempt(v => v + 1)}>{tr('重试')}</button>}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button type="button" disabled={busy} onClick={onClose} style={button}>{tr('取消')}</button>
        <button type="submit" disabled={busy || !session} style={{ ...button, color: arkmeTheme.accent, opacity: busy || !session ? .5 : 1 }}>{tr(busy ? '正在替换…' : '替换')}</button>
      </div>
    </form>
  </div>, document.body)
}
const button = { border: 0, borderRadius: 5, padding: '5px 9px', background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', fontSize: 12 }
