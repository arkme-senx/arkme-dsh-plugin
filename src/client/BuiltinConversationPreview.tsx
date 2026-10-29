import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import type { ArkmeArkoHistoryItem, ArkmeArkoHistoryPage, ArkmeSourceItem, ArkmeTimelineCursor, ArkmeTimelineItem, ArkmeTimelinePage } from '../types.js'
import type { DshAccountSession, DshAccountSessionHistory, DshAccountSessionPage, DshAccountSessionCursor, DshSessionHistoryCursor } from '../dsh-remote/account-session-types.js'
import type { DshRemoteTimelineNode } from '../dsh-remote/types.js'
import { callArkme } from './api.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { ArkoMessageImages } from './ArkoImageAttachments.js'
import { ArkmeMessageTimestamp } from './ArkmeMessageTimestamp.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import type { BuiltinConversation } from './builtin-directory-preferences.js'

const button = { border: 0, padding: '6px 8px', borderRadius: 6, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 13 }
const status = { padding: 16, color: arkmeTheme.secondary, fontSize: 13 }
type Page<T> = { items: T[]; cursor?: string; warning?: string }

/** Read-only pagination, isolated per mounted account and source. Failed pages retain visible content. */
export function useBuiltinPreviewPage<T>(read: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>, key: (item: T) => string) {
  const [page, setPage] = useState<Page<T>>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const request = useRef<AbortController>(), failedCursor = useRef<string>(), keyRef = useRef(key)
  keyRef.current = key
  const load = useCallback(async (cursor?: string) => {
    if (request.current) return
    const controller = new AbortController(); request.current = controller; failedCursor.current = cursor
    setLoading(true); setError('')
    const timer = setTimeout(() => { controller.abort(); setError(tr('内容加载超时，请重试')); setLoading(false); request.current = undefined }, 20000)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    try {
      const next = await read(cursor, controller.signal)
      if (controller.signal.aborted) return
      if (next.cursor !== undefined && next.cursor === cursor) throw new Error(tr('历史分页异常，请重试'))
      setPage(old => ({ ...next, items: [...new Map([...(cursor ? old?.items ?? [] : []), ...next.items].map(item => [keyRef.current(item), item])).values()] }))
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('加载失败，请重试'))
    } finally {
      clearTimeout(timer)
      if (request.current === controller) { request.current = undefined; setLoading(false) }
    }
  }, [read])
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = undefined } }, [load])
  return { page, loading, error, more: () => load(page?.cursor), retry: () => load(failedCursor.current) }
}

function PreviewPage<T>({ state, children, history = true }: { state: ReturnType<typeof useBuiltinPreviewPage<T>>; children: ReactNode; history?: boolean }) {
  const body = useRef<HTMLDivElement>(null), geometry = useRef<{ top: number; height: number }>()
  useLayoutEffect(() => {
    if (!body.current || !state.page || !history) return
    body.current.scrollTop = geometry.current ? geometry.current.top + body.current.scrollHeight - geometry.current.height : body.current.scrollHeight
  }, [state.page, history])
  return <div ref={body} aria-label={tr(history ? '预览消息列表' : '预览任务列表')} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 16px 16px' }}>
    {state.error && <div role="alert" style={status}>{state.error}<button style={button} disabled={state.loading} onClick={() => { void state.retry() }}>{tr('重试')}</button></div>}
    {state.page?.warning && <div role="status" style={status}>{state.page.warning}</div>}
    {history && state.page?.cursor && <button style={button} disabled={state.loading} onClick={() => {
      if (body.current) geometry.current = { top: body.current.scrollTop, height: body.current.scrollHeight }
      void state.more()
    }}>{tr(state.loading ? '正在加载…' : '加载更早消息')}</button>}
    {state.loading && !state.page && <div role="status" style={status}>{tr('正在加载…')}</div>}
    {!state.loading && !state.error && state.page?.items.length === 0 && <div style={status}>{tr('暂无内容')}</div>}
    {children}
    {!history && state.page?.cursor && <button style={button} disabled={state.loading} onClick={() => { void state.more() }}>{tr(state.loading ? '正在加载…' : '加载更多任务')}</button>}
  </div>
}

function Bubble({ own, name, at, children }: { own: boolean; name: string; at: number; children: ReactNode }) {
  return <article style={{ display: 'flex', flexDirection: 'column', alignItems: own ? 'flex-end' : 'flex-start', marginTop: 14, gap: 4 }}>
    <span style={{ fontSize: 11, color: arkmeTheme.secondary }}>{name}</span>
    <div style={{ maxWidth: '94%', minWidth: 0, padding: '8px 10px', borderRadius: 10, background: own ? arkmeTheme.messageOwn : arkmeTheme.messageOther, overflowWrap: 'anywhere' }}>
      {children}<ArkmeMessageTimestamp at={at} />
    </div>
  </article>
}

function SelfPreview({ source }: { source: ArkmeSourceItem }) {
  const read = useCallback(async (cursor: string | undefined, signal: AbortSignal): Promise<Page<ArkmeTimelineItem>> => {
    const page = await callArkme<ArkmeTimelinePage>('source.timeline', { sourceRef: source.sourceRef, limit: 40,
      ...(cursor ? { cursor: JSON.parse(cursor) as ArkmeTimelineCursor } : {}) }, signal)
    if (page.hasMore && !page.nextCursor) throw new Error(tr('历史分页异常，请重试'))
    return { items: page.items, ...(page.hasMore ? { cursor: JSON.stringify(page.nextCursor) } : {}) }
  }, [source.sourceRef])
  const state = useBuiltinPreviewPage(read, item => item.itemUid)
  return <PreviewPage state={state}>{[...state.page?.items ?? []].sort((a,b) => a.sendAtMillis - b.sendAtMillis).map(item =>
    <Bubble key={item.itemUid} own={item.isMe} name={item.senderName || tr('我')} at={item.sendAtMillis}><ArkmeMessageContent item={item} presentation="detail" /></Bubble>)}</PreviewPage>
}

function ArkoPreview({ name }: { name: string }) {
  const read = useCallback(async (cursor: string | undefined, signal: AbortSignal): Promise<Page<ArkmeArkoHistoryItem>> => {
    const page = await callArkme<ArkmeArkoHistoryPage>('arko.history', { limit: 40, offset: Number(cursor ?? 0) }, signal)
    if (page.hasMore && (!Number.isFinite(page.nextOffset) || page.nextOffset! <= Number(cursor ?? 0))) throw new Error(tr('历史分页异常，请重试'))
    return { items: page.items, ...(page.hasMore ? { cursor: String(page.nextOffset) } : {}) }
  }, [])
  const state = useBuiltinPreviewPage(read, item => `${item.sessionId}:${item.messageId}`)
  return <PreviewPage state={state}>{[...state.page?.items ?? []].sort((a,b) => a.createdAtMillis-b.createdAtMillis || a.messageId-b.messageId).map(item =>
    <Bubble key={`${item.sessionId}:${item.messageId}`} own={item.role === 'user'} name={item.role === 'user' ? tr('我') : name} at={item.createdAtMillis}>
      <ArkoMessageImages blocks={item.contentBlocks ?? []} />
      {item.role === 'assistant' ? <ArkmeMarkdownBody text={item.text} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.6 }} />
        : <span style={{ whiteSpace: 'pre-wrap' }}>{item.text}</span>}
    </Bubble>)}</PreviewPage>
}

function HarnessHistory({ session }: { session: DshAccountSession }) {
  const read = useCallback(async (cursor: string | undefined, signal: AbortSignal): Promise<Page<DshRemoteTimelineNode>> => {
    const page = await callArkme<DshAccountSessionHistory>('remote.session.read', { runtimeRef: session.runtimeRef, sessionRef: session.sessionRef,
      source: session.presence === 'online' && session.capabilities.includes('session.history') ? 'host' : 'cloud',
      ...(cursor ? { cursor: JSON.parse(cursor) as DshSessionHistoryCursor } : {}) }, signal)
    return { items: page.nodes, ...(page.nextCursor ? { cursor: JSON.stringify(page.nextCursor) } : {}), ...(page.warning ? { warning: page.warning } : {}) }
  }, [session.runtimeRef, session.sessionRef, session.presence, session.capabilities])
  const state = useBuiltinPreviewPage(read, item => item.node_ref)
  return <PreviewPage state={state}>{[...state.page?.items ?? []].sort((a,b) => a.anchor_seq-b.anchor_seq || a.ordinal-b.ordinal).map(item =>
    <Bubble key={item.node_ref} own={item.kind === 'user'} name={item.kind === 'user' ? tr('我') : item.kind === 'assistant' ? 'DeepSeek Harness' : item.presentation.title || tr('任务活动')} at={item.time}>
      <ArkmeMarkdownBody text={item.presentation.details || item.presentation.summary || item.presentation.title || tr('暂无文本内容')} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.6 }} />
    </Bubble>)}</PreviewPage>
}

function HarnessSessions({ onSelect }: { onSelect(session: DshAccountSession): void }) {
  const read = useCallback(async (cursor: string | undefined, signal: AbortSignal): Promise<Page<DshAccountSession>> => {
    const page = await callArkme<DshAccountSessionPage>('remote.sessions.list', { limit: 40, ...(cursor ? { cursor: JSON.parse(cursor) as DshAccountSessionCursor } : {}) }, signal)
    if (page.contractVersion !== 1) throw new Error(tr('账号会话协议版本不受支持'))
    return { items: page.items.filter(item => !item.archived && item.origin !== 'subagent'), ...(page.nextCursor ? { cursor: JSON.stringify(page.nextCursor) } : {}), ...(page.warning ? { warning: page.warning } : {}) }
  }, [])
  const state = useBuiltinPreviewPage(read, item => JSON.stringify([item.runtimeRef, item.sessionRef]))
  return <PreviewPage state={state} history={false}>{state.page?.items.map(session => <button key={JSON.stringify([session.runtimeRef, session.sessionRef])} style={{ ...button, display: 'block', width: '100%', textAlign: 'left', padding: '12px 0', borderBottom: `1px solid ${arkmeTheme.borderSoft}`, color: arkmeTheme.text }} onClick={() => onSelect(session)}>
    <strong style={{ display: 'block', fontWeight: 500 }}>{session.title || tr('未命名任务')}</strong>
    <span style={{ display: 'block', fontSize: 12, marginTop: 5, color: arkmeTheme.secondary }}>{[session.workspaceName, session.desktopName, session.running ? tr('进行中') : ''].filter(Boolean).join(' · ')}</span>
  </button>)}</PreviewPage>
}

/** Intentionally never mount the composer, native iframe or acknowledgement owners. */
export function BuiltinConversationPreview({ kind, name, selfSource, onClose }: { kind: BuiltinConversation; name: string; selfSource?: ArkmeSourceItem | undefined; onClose(): void }) {
  useArkmeLocale()
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const [session, setSession] = useState<DshAccountSession>()
  const dialog = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { dialog.current?.focus({ preventScroll: true }) }, [session])
  if (typeof document === 'undefined') return null
  return createPortal(<div data-arkme-builtin-preview-backdrop style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,.3)' }}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${name}的聊天预览`}
      style={{ width: 460, maxWidth: '100%', height: 520, maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 16, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}
      onKeyDown={event => {
        if (event.target instanceof Element && event.target.closest('[aria-modal="true"]') !== dialog.current) return
        event.stopPropagation()
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onClose() }
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')
          const first = controls?.[0], last = controls?.[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}>
        {session && <button style={button} aria-label={tr('返回任务列表')} onClick={() => setSession(undefined)}><ArrowLeft size={18} /></button>}
        <strong style={{ minWidth: 0, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session?.title || name}</strong>
        <span style={{ flex: 'none', borderRadius: 99, background: arkmeTheme.subtle, color: arkmeTheme.secondary, padding: '3px 8px', fontSize: 11 }}>{tr('预览中')}</span>
        <button style={{ ...button, marginLeft: 'auto', color: arkmeTheme.secondary }} aria-label={tr('关闭聊天预览')} onClick={onClose}><X size={20} /></button>
      </header>
      {kind === 'self' && (selfSource ? <><div style={{ padding: '8px 16px', color: arkmeTheme.secondary, fontSize: 12 }}>{selfSource.kind === 'send_to_self' ? tr('全部') : selfSource.displayName}</div><SelfPreview key={selfSource.sourceRef} source={selfSource} /></> : <p role="status" style={status}>{tr('发给自己暂不可用，请稍后重试')}</p>)}
      {kind === 'arko' && <ArkoPreview name={name} />}
      {kind === 'harness' && (session ? <HarnessHistory key={JSON.stringify([session.runtimeRef, session.sessionRef])} session={session} /> : <HarnessSessions onSelect={setSession} />)}
    </div>
  </div>, document.body)
}
