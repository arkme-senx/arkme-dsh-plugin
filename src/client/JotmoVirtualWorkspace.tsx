import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { JotmoAuthSnapshot, JotmoSourceDirectory, JotmoSourceItem, JotmoSourceList } from '../types.js'
import { callJotmo } from './api.js'
import { JotmoMark } from './JotmoFooterAction.js'
import { jotmoUi } from './ui-controller.js'

export interface JotmoNavigationProps { wide?: boolean }

const styles: Record<string, CSSProperties> = {
  group: { flex: 'none', margin: '0 0 6px', color: 'var(--dsw-alias-label-primary, #17191c)' },
  row: {
    width: '100%', minHeight: 34, display: 'flex', alignItems: 'center', gap: 6,
    boxSizing: 'border-box', border: 0, borderRadius: 8, outline: 0, padding: '0 8px', background: 'transparent',
    color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left', userSelect: 'none',
  },
  leading: { flex: 'none', width: 16, display: 'inline-flex', justifyContent: 'center', alignItems: 'center' },
  trailing: { flex: 'none', width: 14, display: 'inline-flex', justifyContent: 'center', color: '#9097a1' },
  chevron: {
    width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent',
    borderLeft: '6px solid currentColor', transition: 'transform 150ms var(--ds-ease-in-out)',
  },
  title: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 },
  badge: {
    flex: 'none', padding: '1px 6px', borderRadius: 999, color: '#c2413b',
    background: 'rgba(194, 65, 59, .1)', fontSize: 11, lineHeight: '18px',
  },
  child: { paddingLeft: 24, minHeight: 32, marginTop: 2 },
  active: { background: 'var(--dsw-alias-interactive-bg-hover, #eef1f5)' },
  meta: { flex: 'none', color: 'var(--dsw-alias-label-caption, #adb2b8)', fontSize: 11 },
  preview: {
    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 11, lineHeight: '16px',
  },
  kind: { width: 16, color: 'var(--dsw-alias-label-caption, #adb2b8)', fontSize: 10, textAlign: 'center' },
  status: { padding: '5px 32px', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 11 },
  rail: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 0 6px' },
  railButton: {
    width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 0, borderRadius: 8, outline: 0, background: 'transparent', cursor: 'pointer',
  },
}

function sourceKindLabel(source: JotmoSourceItem): string {
  if (source.kind === 'group_chat') return '群'
  if (source.kind === 'private_chat') return '私'
  return ''
}

export function JotmoNavigation({ wide = true }: JotmoNavigationProps) {
  const selectedSurface = true
  const ui = useSyncExternalStore(jotmoUi.subscribe, jotmoUi.getSnapshot)
  const [auth, setAuth] = useState<JotmoAuthSnapshot>()
  const [expanded, setExpanded] = useState(true)
  const [directory, setDirectory] = useState<JotmoSourceDirectory>('root')
  const [sources, setSources] = useState<JotmoSourceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const authenticated = auth?.status === 'authenticated'

  const refreshAuth = useCallback(async () => {
    try { setAuth(await callJotmo<JotmoAuthSnapshot>('auth.status')) }
    catch { setAuth({ status: 'logged-out', environment: 'test' }) }
  }, [])

  const loadDirectory = useCallback(async (next: JotmoSourceDirectory) => {
    setLoading(true)
    setError('')
    try {
      const loaded: JotmoSourceItem[] = []
      let cursor: string | undefined
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await callJotmo<JotmoSourceList>('sources.list', {
          directory: next,
          limit: next === 'root' ? 50 : 100,
          ...(cursor === undefined ? {} : { cursor }),
        })
        const known = new Set(loaded.map(item => item.sourceRef))
        loaded.push(...page.items.filter(item => !known.has(item.sourceRef)))
        if (!page.hasMore || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      setSources(loaded)
    } catch (caught) {
      setSources([])
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refreshAuth() }, [refreshAuth, ui.authRevision])
  useEffect(() => {
    if (authenticated && expanded) void loadDirectory(directory)
    else if (!authenticated) setSources([])
  }, [authenticated, directory, expanded, loadDirectory])

  const showLogin = () => { jotmoUi.showLogin() }
  const selectSource = (source: JotmoSourceItem) => { jotmoUi.selectSource(source) }

  if (!wide) {
    return (
      <div style={styles.rail}>
        <button
          type="button"
          style={{ ...styles.railButton, ...(selectedSurface ? styles.active : {}) }}
          aria-label={authenticated ? '即我' : '即我 · 未登录'}
          title={authenticated ? '即我' : '即我 · 未登录'}
          onClick={() => {
            if (!authenticated || ui.selectedSource === undefined) showLogin()
            else { jotmoUi.selectSource(ui.selectedSource) }
          }}
        ><JotmoMark size={20} /></button>
      </div>
    )
  }

  return (
    <section style={styles.group} role="tree" aria-label="即我工作区">
      <button
        type="button"
        role="treeitem"
        aria-expanded={authenticated ? expanded : undefined}
        aria-label="即我"
        style={styles.row}
        onClick={() => {
          if (!authenticated) { showLogin(); return }
          if (directory === 'send_to_self') { setDirectory('root'); setExpanded(true); return }
          setExpanded(value => !value)
        }}
      >
        <span style={styles.leading} aria-hidden>
          <JotmoMark size={16} />
        </span>
        <span style={styles.title}>{directory === 'send_to_self' ? '‹ 发给自己' : '即我'}</span>
        {authenticated && directory === 'root' && <span style={styles.trailing} aria-hidden>
          <span style={{ ...styles.chevron, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} />
        </span>}
        {!authenticated && <span style={styles.badge}>未登录</span>}
      </button>

      {authenticated && expanded && directory === 'root' && (
        <>
          <button type="button" role="treeitem" style={{ ...styles.row, ...styles.child }} onClick={() => { setDirectory('send_to_self') }}>
            <span style={styles.kind}>自</span><span style={styles.title}>发给自己</span><span style={styles.meta}>›</span>
          </button>
          {sources.map(source => (
            <button
              key={source.sourceRef}
              type="button"
              role="treeitem"
              aria-selected={ui.selectedSource?.sourceRef === source.sourceRef && selectedSurface}
              style={{ ...styles.row, ...styles.child, ...(ui.selectedSource?.sourceRef === source.sourceRef && selectedSurface ? styles.active : {}) }}
              onClick={() => { selectSource(source) }}
            >
              <span style={styles.kind}>{sourceKindLabel(source)}</span>
              <span style={styles.title}>
                {source.displayName}
                {source.latestPreview !== undefined && <span style={styles.preview}>{source.latestPreview}</span>}
              </span>
              {source.unreadCount > 0 && <span style={styles.meta}>{source.unreadCount}</span>}
            </button>
          ))}
        </>
      )}

      {authenticated && expanded && directory === 'send_to_self' && sources.map(source => (
        <button
          key={source.sourceRef}
          type="button"
          role="treeitem"
          aria-selected={ui.selectedSource?.sourceRef === source.sourceRef && selectedSurface}
          style={{ ...styles.row, ...styles.child, ...(ui.selectedSource?.sourceRef === source.sourceRef && selectedSurface ? styles.active : {}) }}
          onClick={() => { selectSource(source) }}
        >
          <span style={styles.kind}>·</span><span style={styles.title}>{source.displayName}</span>
          {source.recordCount !== undefined && <span style={styles.meta}>{source.recordCount}</span>}
        </button>
      ))}

      {authenticated && expanded && loading && <div style={styles.status}>正在读取…</div>}
      {authenticated && expanded && error !== '' && <div style={{ ...styles.status, color: '#c2413b' }}>{error}</div>}
    </section>
  )
}
