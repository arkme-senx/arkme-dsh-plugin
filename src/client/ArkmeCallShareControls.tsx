import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ExportIcon } from '@phosphor-icons/react/dist/csr/Export'
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeCallShareLink, ArkmeCallShareViewer, ArkmeCallShareViewers } from '../types.js'
import { callArkme } from './api.js'
import { copyText } from './clipboard-text.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { arkmeAuthStore } from './auth-store.js'

const button: CSSProperties = { border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, padding: '5px 10px', background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit', cursor: 'pointer' }

/** Detail-owned UI shared by the call browser and conversation drawer, not a global sharing state. */
export function ArkmeCallShareControls({ callRef, compact = false }: { callRef: string; compact?: boolean }) {
  const { auth } = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const scope = `${auth?.environment ?? ''}:${auth?.userId ?? ''}:${auth?.status ?? ''}`
  return <CallShareControls key={`${scope}:${callRef}`} callRef={callRef} compact={compact} />
}

function CallShareControls({ callRef, compact }: { callRef: string; compact: boolean }) {
  const viewersId = useId()
  const root = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [nativeUrl, setNativeUrl] = useState('')
  const supportsNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
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

  const showSuccess = (text: string) => {
    setNotice(text)
    noticeTimer.current = setTimeout(() => { setNotice(''); noticeTimer.current = undefined }, 3000)
  }
  const share = async (target: 'copy' | 'system', preparedUrl?: string) => {
    if (copying.current) return
    setMenuOpen(false)
    closeViewers()
    const request = new AbortController(); copying.current = request
    clearTimeout(noticeTimer.current)
    setCopyPending(true); setNotice('正在准备分享…'); setNativeUrl('')
    let url = preparedUrl
    try {
      if (!url) url = (await callArkme<ArkmeCallShareLink>('calls.share.ensure', { callRef }, request.signal)).url
      if (request.signal.aborted) return
      if (target === 'copy') {
        await copyText(url)
        if (!request.signal.aborted) showSuccess('链接已复制')
      } else {
        // A slow ensure request may consume Web Share's transient activation.
        // Keep a user-initiated continuation instead of reporting a false failure.
        if (navigator.userActivation?.isActive === false) {
          setNativeUrl(url); setNotice('链接已准备好，点击继续分享')
          return
        }
        await navigator.share({ title: '通话详情', url })
        if (!request.signal.aborted) setNotice('')
      }
    } catch (error) {
      if (!request.signal.aborted) {
        const name = error instanceof Error ? error.name : ''
        if (target === 'system' && url && name === 'AbortError') setNotice('')
        else if (target === 'system' && url && name === 'NotAllowedError') {
          setNativeUrl(url); setNotice('请点击继续分享，或复制链接')
        } else setNotice(!url ? '分享链接生成失败，请重试' : target === 'copy' ? '复制链接失败，请重试' : '系统分享未完成，请重试或复制链接')
      }
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
    setMenuOpen(false)
    setExpanded(true)
    void load()
  }
  const closeViewers = () => {
    setExpanded(false)
    reading.current?.abort()
    reading.current = undefined
    setPending(false)
  }
  useEffect(() => {
    if (!expanded || typeof document === 'undefined') return
    const own = root.current?.ownerDocument ?? document
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) closeViewers()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      closeViewers(); trigger.current?.focus()
    }
    own.addEventListener('pointerdown', outside, true)
    own.addEventListener('keydown', escape, true)
    return () => { own.removeEventListener('pointerdown', outside, true); own.removeEventListener('keydown', escape, true) }
  }, [expanded])
  return <section ref={root} aria-label="通话分享" style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, fontSize: 12, color: arkmeTheme.secondary }}>
    <ArkmeActionMenu open={menuOpen} label="通话分享菜单" align="end" autoFocus
      onClose={() => { setMenuOpen(false) }}
      anchor={<button ref={trigger} data-arkme-feedback="neutral" type="button" aria-label="分享" title="分享通话详情" aria-haspopup="menu" aria-expanded={menuOpen} style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, marginTop: compact ? -3 : 0, display: 'grid', placeItems: 'center', padding: 0, border: compact ? 0 : `1px solid ${arkmeTheme.border}`, borderRadius: compact ? 8 : 10, background: compact ? 'transparent' : arkmeTheme.elevated, color: compact ? arkmeTheme.tertiary : arkmeTheme.text, cursor: copyPending ? 'wait' : 'pointer' }} aria-busy={copyPending} aria-disabled={copyPending}
        onClick={() => { if (!copying.current) { closeViewers(); setMenuOpen(value => !value) } }}><ExportIcon size={19} aria-hidden /></button>}
      actions={[
        { id: 'copy', label: '复制链接', disabled: copyPending, onSelect: () => { void share('copy') } },
        supportsNativeShare && { id: 'system', label: '系统分享', disabled: copyPending, onSelect: () => { void share('system') } },
        { id: 'viewers', label: '查看记录', onSelect: openViewers },
      ]} />
    {expanded && <div style={{ position: 'absolute', top: '100%', right: 0, paddingTop: 8, width: 'min(360px, calc(100vw - 48px))', zIndex: 30 }}>
      <div id={viewersId} role="region" aria-label="外部查看记录" aria-busy={pending} style={{ padding: 12, maxHeight: 280, overflowY: 'auto', background: arkmeTheme.base, border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>外部查看记录</strong><span style={{ display: 'flex', gap: 6 }}><button type="button" style={button} aria-disabled={pending} onClick={() => { void load() }}>刷新</button><button type="button" style={button} aria-label="关闭查看记录" onClick={() => { closeViewers(); trigger.current?.focus() }}>关闭</button></span></div>
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
    {notice && !expanded && <div role="status" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 'max-content', maxWidth: 'min(320px, calc(100vw - 48px))', padding: '6px 10px', background: arkmeTheme.base, border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, zIndex: 30 }}>
      {notice}
      {nativeUrl && <span style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" style={button} onClick={() => { void share('system', nativeUrl) }}>继续分享</button>
        <button type="button" style={button} onClick={() => { void share('copy', nativeUrl) }}>复制链接</button>
      </span>}
    </div>}
  </section>
}
