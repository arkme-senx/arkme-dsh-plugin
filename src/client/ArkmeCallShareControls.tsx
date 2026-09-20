import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ExportIcon } from '@phosphor-icons/react/dist/csr/Export'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeCallShareLink, ArkmeCallShareViewer, ArkmeCallShareViewers } from '../types.js'
import { callArkme } from './api.js'
import { copyText } from './clipboard-text.js'
import { arkmeTheme } from './arkme-theme.js'

const button: CSSProperties = { border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, padding: '5px 10px', background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit', cursor: 'pointer' }

/** Detail-owned UI shared by the call browser and conversation drawer, not a global sharing state. */
export function ArkmeCallShareControls({ callRef }: { callRef: string }) {
  return <CallShareControls key={callRef} callRef={callRef} />
}

function CallShareControls({ callRef }: { callRef: string }) {
  const viewersId = useId()
  const copying = useRef<AbortController>()
  const reading = useRef<AbortController>()
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>()
  const [copyPending, setCopyPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [items, setItems] = useState<ArkmeCallShareViewer[]>([])
  const [nextCursor, setNextCursor] = useState('')
  const [error, setError] = useState('')
  const retryCursor = useRef('')
  useEffect(() => () => { copying.current?.abort(); reading.current?.abort(); clearTimeout(noticeTimer.current) }, [])

  const share = async () => {
    if (copying.current) return
    const request = new AbortController(); copying.current = request
    clearTimeout(noticeTimer.current)
    setCopyPending(true); setNotice('')
    try {
      const result = await callArkme<ArkmeCallShareLink>('calls.share.ensure', { callRef }, request.signal)
      if (request.signal.aborted) return
      await copyText(result.url)
      if (!request.signal.aborted) {
        setNotice('链接已复制')
        noticeTimer.current = setTimeout(() => { setNotice(''); noticeTimer.current = undefined }, 3000)
      }
    } catch {
      if (!request.signal.aborted) setNotice('复制链接失败，请重试')
    } finally {
      if (!request.signal.aborted) { copying.current = undefined; setCopyPending(false) }
    }
  }
  const load = async (cursor = '') => {
    if (reading.current) return
    const request = new AbortController(); reading.current = request
    retryCursor.current = cursor; setPending(true); setError('')
    try {
      const page = await callArkme<ArkmeCallShareViewers>('calls.share.viewers', { callRef, cursor }, request.signal)
      if (request.signal.aborted) return
      setItems(previous => {
        const byEvent = new Map((cursor ? previous : []).map(item => [item.viewId, item]))
        for (const item of page.items) byEvent.set(item.viewId, item)
        return [...byEvent.values()]
      })
      setNextCursor(page.nextCursor)
    } catch {
      if (!request.signal.aborted) setError('查看记录加载失败')
    } finally {
      if (!request.signal.aborted) { reading.current = undefined; setPending(false) }
    }
  }
  const openViewers = () => {
    if (expanded) return
    setExpanded(true)
    void load()
  }
  const closeViewers = () => {
    setExpanded(false)
    reading.current?.abort()
    reading.current = undefined
    setPending(false)
  }
  return <section aria-label="通话分享" style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, fontSize: 12, color: arkmeTheme.secondary }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div data-call-share-trigger style={{ position: 'relative', display: 'inline-flex' }}
        onMouseEnter={openViewers} onMouseLeave={closeViewers}
        onFocusCapture={openViewers}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeViewers() }}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeViewers() } }}>
        <button type="button" aria-label="分享" aria-expanded={expanded} aria-controls={expanded ? viewersId : undefined} style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer' }} aria-busy={copyPending} aria-disabled={copyPending} onClick={() => { void share() }}><ExportIcon size={19} aria-hidden /></button>
        {expanded && <div style={{ position: 'absolute', top: '100%', right: 0, paddingTop: 8, width: 'min(360px, calc(100vw - 48px))', zIndex: 30 }}>
          <div id={viewersId} role="region" aria-label="外部查看记录" aria-busy={pending} style={{ padding: 12, maxHeight: 280, overflowY: 'auto', background: arkmeTheme.base, border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>外部查看记录</strong><button type="button" style={button} aria-disabled={pending} onClick={() => { void load() }}>刷新</button></div>
            {notice && <p role="status">{notice}</p>}
            {items.length > 0 && <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>{items.map(item => <li key={item.viewId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <ArkmeUserAvatar {...(item.avatarRef ? { avatarRef: item.avatarRef } : {})} size={32} label={`${item.displayName}头像`} />
              <span style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                <span style={{ overflowWrap: 'anywhere', color: arkmeTheme.text }}>{item.displayName}</span>
                <time dateTime={new Date(item.viewedAtMillis).toISOString()} style={{ color: arkmeTheme.tertiary }}>{new Date(item.viewedAtMillis).toLocaleString('zh-CN', { hour12: false })}</time>
              </span>
            </li>)}</ul>}
            {pending && <p role="status">加载中…</p>}
            {error ? <p role="alert">{error} <button type="button" style={button} aria-disabled={pending} onClick={() => { void load(retryCursor.current) }}>重试</button></p> : !pending && items.length === 0 && <p>暂无外部人员查看</p>}
            {nextCursor && !error && <button type="button" style={button} aria-disabled={pending} onClick={() => { void load(nextCursor) }}>加载更多</button>}
          </div>
        </div>}
      </div>
      {notice && !expanded && <span role="status" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, whiteSpace: 'nowrap', padding: '6px 10px', background: arkmeTheme.base, border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, zIndex: 30 }}>{notice}</span>}
    </div>
  </section>
}
