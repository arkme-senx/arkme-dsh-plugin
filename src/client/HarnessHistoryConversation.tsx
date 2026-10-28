import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import type { DshAccountSession, DshAccountSessionHistory, DshSessionHistoryCursor } from '../dsh-remote/account-session-types.js'
import type { DshRemoteTimelineNode } from '../dsh-remote/types.js'
import { callArkme } from './api.js'
import { useBuiltinPreviewPage, type Page } from './builtin-preview-page.js'
import { WindowedTimelineRows } from './WindowedTimelineRows.js'
import { watchHarnessSessionHover } from './harness-session-hover.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
const status = { padding: 16, color: arkmeTheme.secondary, fontSize: 13 }
const button = { border: 0, padding: '6px 8px', borderRadius: 6, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit', fontSize: 13 }

function HarnessHistory({ session, renderNode }: { session: DshAccountSession; renderNode(node: DshRemoteTimelineNode): ReactNode }) {
  const read = useCallback(async (cursor: string | undefined, signal: AbortSignal): Promise<Page<DshRemoteTimelineNode>> => {
    const page = await callArkme<DshAccountSessionHistory>('remote.session.read', { runtimeRef: session.runtimeRef, sessionRef: session.sessionRef,
      source: 'cloud',
      ...(cursor ? { cursor: JSON.parse(cursor) as DshSessionHistoryCursor } : {}) }, signal)
    return { items: page.nodes, ...(page.nextCursor ? { cursor: JSON.stringify(page.nextCursor) } : {}), ...(page.warning ? { warning: page.warning } : {}) }
  }, [session.runtimeRef, session.sessionRef])
  const state = useBuiltinPreviewPage(read, item => item.node_ref)
  return <HarnessHistoryMessages state={state} renderNode={renderNode} />
}

/** The same lazy history behavior as a conversation: reaching the top fetches the next page. */
function HarnessHistoryMessages({ state, renderNode }: { state: ReturnType<typeof useBuiltinPreviewPage<DshRemoteTimelineNode>>; renderNode(node: DshRemoteTimelineNode): ReactNode }) {
  const body = useRef<HTMLDivElement>(null), geometry = useRef<{ top: number; height: number }>()
  useLayoutEffect(() => {
    const node = body.current
    if (!node || !state.page) return
    node.scrollTop = geometry.current ? geometry.current.top + node.scrollHeight - geometry.current.height : node.scrollHeight
    geometry.current = undefined
  }, [state.page])
  useEffect(() => {
    const node = body.current
    if (node && node.clientHeight > 0 && node.scrollHeight <= node.clientHeight && state.page?.cursor && !state.loading && !state.error) void state.more()
  }, [state.page, state.loading, state.error])
  const items = [...state.page?.items ?? []].sort((a,b) => a.anchor_seq-b.anchor_seq || a.ordinal-b.ordinal)
  return <div ref={body} aria-label={tr('消息列表')} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '12px 24px' }}
    onScroll={() => {
      const node = body.current
      if (!node || node.scrollTop > 80 || !state.page?.cursor || state.loading || state.error) return
      geometry.current = { top: node.scrollTop, height: node.scrollHeight }; void state.more()
    }}>
    {state.error && <div role="alert" style={status}>{state.error}<button style={button} disabled={state.loading} onClick={() => { void state.retry() }}>{tr('重试')}</button></div>}
    {state.loading && !state.page && <div role="status" style={status}>{tr('正在加载…')}</div>}
    <ol style={{ maxWidth: 'var(--dsh-chat-user-width, 680px)', margin: '0 auto', padding: 0, listStyle: 'none' }}>
      <WindowedTimelineRows rowIds={items.map(item => ({ id: item.node_ref }))} scrollport={body}>{items.map(item => <div key={item.node_ref} style={{ marginBottom: 24 }}>{renderNode(item)}</div>)}</WindowedTimelineRows>
    </ol>
  </div>
}

/** The native frame retains the shared session menu while history occupies the conversation seat. */
export function HarnessHistoryConversation({ session, accountScope, composer, renderNode }: { session: DshAccountSession; accountScope: string; composer: ReactNode; renderNode(node: DshRemoteTimelineNode): ReactNode }) {
  useArkmeLocale()
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const selector = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => selector.current ? watchHarnessSessionHover(selector.current, accountScope, () => {}, true) : undefined, [accountScope])
  return <section aria-label={tr('DeepSeek Harness 对话')} data-arkme-history-conversation style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: arkmeTheme.base, color: arkmeTheme.text }}>
    <header style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start', gap: 8, padding: '10px 20px' }}>
      <strong style={{ fontSize: 15, lineHeight: '30px' }}>DeepSeek Harness</strong>
      <div style={{ minWidth: 0, textAlign: 'center' }}>
        <button ref={selector} data-arkme-conversation-selector aria-label={`${tr('切换会话')}：${session.title || tr('未命名任务')}`} style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%', height: 30, padding: 0, border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 10, background: arkmeTheme.base, color: 'inherit', font: 'inherit', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>
          <span style={{ padding: '0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title || tr('未命名任务')}</span>
          <span style={{ display: 'inline-flex', padding: '6px 8px', borderLeft: `1px solid ${arkmeTheme.borderSoft}` }}><CaretDown size={14} /></span>
        </button>
        <div title={session.runtimeName} style={{ marginTop: 4, fontSize: 12, color: arkmeTheme.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr('其他实例')}{session.desktopName ? ` · ${session.desktopName}` : ''}</div>
      </div>
    </header>
    <HarnessHistory key={JSON.stringify([session.runtimeRef, session.sessionRef])} session={session} renderNode={renderNode} />
    <div style={{ padding: '0 24px 20px', width: '100%', maxWidth: 'calc(var(--dsh-composer-card-max-width, 680px) + 48px)', boxSizing: 'border-box', margin: '0 auto' }}>{composer}</div>
  </section>
}
