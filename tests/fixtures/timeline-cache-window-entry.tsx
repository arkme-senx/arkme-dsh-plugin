import { createRoot } from 'react-dom/client'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { WindowedTimelineRows } from '../../src/client/WindowedTimelineRows.js'
import { useConversationViewport, type ArkmeConversationViewportRestore } from '../../src/client/conversation-viewport.js'
import { ArkmeConversationMemoryCache } from '../../src/client/conversation-memory-cache.js'
import { ConversationViewportPersistence } from '../../src/client/conversation-viewport-persistence.js'
import { useConversationResizeAnchor } from '../../src/client/conversation-resize-anchor.js'
const persistence = new ConversationViewportPersistence(); persistence.setScope('fixture:1')
const cache = new ArkmeConversationMemoryCache(20, persistence)
window.addEventListener('pagehide', persistence.flush)
function Fixture() {
  const [source, setSource] = useState('A')
  const [revision, setRevision] = useState(0)
  const body = useRef<HTMLDivElement>(null), list = useRef<HTMLUListElement>(null)
  const pending = useRef<ArkmeConversationViewportRestore>()
  const intent = useRef<boolean>()
  const rows = useMemo(() => Array.from({ length: source === 'A' ? 2000 : 80 }, (_, index) => ({ id: `${source}:${index}`, index })), [source])
  const content = useMemo(() => rows.map(row => <li key={row.id} data-arkme-conversation-row={row.id}
    style={{ listStyle: 'none', boxSizing: 'border-box', minHeight: 40 + row.index % 7 * 17, padding: 8, borderBottom: '1px solid #ddd' }}>
    <b>{row.id}</b> 消息 {revision}<div>{'正文 '.repeat(10 + row.index % 6)}</div></li>), [rows, revision])
  useLayoutEffect(() => { pending.current = { sourceKey: source, viewport: cache.getViewport(source) } }, [source, revision])
  const remember = useConversationViewport({ active: true, sourceKey: source, renderedSourceKey: source,
    bodyRef: body, store: cache, pendingRestore: pending, restoreIntent: intent })
  useConversationResizeAnchor(body, source, undefined, false, list, intent)
  Object.assign(window, { timelineTest: { select: setSource, refresh: () => setRevision(value => value + 1),
    saved: () => cache.getViewport(source), flush: persistence.flush } })
  return <><h1>本地窗口测试</h1><button onClick={() => setSource(source === 'A' ? 'B' : 'A')}>切换会话</button>
    <button onClick={() => setRevision(value => value + 1)}>刷新正文</button>
    <div id="viewport" ref={body} onScroll={remember} style={{ height: 500, overflow: 'auto', border: '1px solid black' }}>
      <ul ref={list} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        <WindowedTimelineRows key={source} rowIds={rows} scrollport={body} anchorId={cache.getViewport(source)?.anchorId}>{content}</WindowedTimelineRows>
      </ul>
    </div></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
