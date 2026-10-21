import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { tr } from './locale.js'
import { ArkmeMentionSuggestionRow, ArkmeMentionSuggestionThemeStyles, type ArkmeMentionSuggestionRowStyles } from './ArkmeMentionSuggestionRow.js'
import type { ArkmeMentionCandidate } from './mention-candidates.js'
import type { useMentionSuggestions } from './use-mention-suggestions.js'

export function ArkmeMentionSuggestions({ session, style, rowStyles, loading, error, onRetry, onSelect }: {
  session: ReturnType<typeof useMentionSuggestions>
  style: CSSProperties
  rowStyles: ArkmeMentionSuggestionRowStyles
  loading: boolean
  error: boolean
  onRetry: () => void
  onSelect: (candidate: ArkmeMentionCandidate) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = 0 }, [session.key])
  useLayoutEffect(() => {
    if (session.navigationRevision === 0) return
    const viewport = list.current
    const row = viewport?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!viewport || !row) return
    if (row.offsetTop < viewport.scrollTop) viewport.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = row.offsetTop + row.offsetHeight - viewport.clientHeight
  }, [session.navigationRevision])
  return <div data-arkme-mention-popup style={{ ...style, height: session.height, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
    <ArkmeMentionSuggestionThemeStyles />
    <div ref={list} role="listbox" aria-label={tr('选择要 @ 的对象')} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowAnchor: 'none', position: 'relative' }}>
      {session.rows.length === 0 && <div style={{ padding: 8, fontSize: 12 }}>{loading ? tr('正在查找…') : tr('暂无可 @ 的对象')}</div>}
      {session.rows.map(row => <ArkmeMentionSuggestionRow key={row.key} candidate={row.candidate}
        active={row.available && row.key === session.activeKey} disabled={!row.available}
        styles={rowStyles} onActive={() => session.activate(row.key)} onSelect={() => { if (row.available) onSelect(row.candidate) }} />)}
    </div>
    <div role="status" style={{ flex: '0 0 22px', fontSize: 11, lineHeight: '22px', paddingLeft: 8, opacity: .7 }}>
      {error ? <>{tr('Bot 加载失败，仍可选择已有对象')} · <button type="button" onMouseDown={event => event.preventDefault()} onClick={onRetry} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>{tr('重试')}</button></>
        : loading ? tr('正在补充候选…') : null}
    </div>
  </div>
}
