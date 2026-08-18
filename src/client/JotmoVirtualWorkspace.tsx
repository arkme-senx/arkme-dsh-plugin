import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties,
} from 'react'
import type {
  JotmoAuthSnapshot, JotmoImagePayload, JotmoSourceDirectory, JotmoSourceItem, JotmoSourceList,
} from '../types.js'
import { callJotmo } from './api.js'
import { JotmoMark } from './JotmoFooterAction.js'
import {
  cachedSelectedSource, clearLastNavigationCache, readLastNavigationCache,
  readNavigationCache, writeNavigationCache, type JotmoNavigationCache,
} from './navigation-cache.js'
import { jotmoUi } from './ui-controller.js'

export interface JotmoNavigationProps {
  wide?: boolean
  onClose?: () => void
}

const colors = {
  panel: 'var(--dsw-specific-sidebar-fill, #f8f9fa)',
  text: 'var(--dsw-alias-label-primary, #242629)',
  secondary: 'var(--dsw-alias-label-secondary, #8a9099)',
  caption: 'var(--dsw-alias-label-caption, #b0b5bc)',
  border: 'var(--dsw-alias-border-l1, #eceef0)',
  active: '#def3e8',
  accent: '#20c66a',
}

const styles: Record<string, CSSProperties> = {
  shell: { width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: colors.text },
  header: {
    flex: 'none', height: 56, display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 14px 0 18px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
  },
  headerTitle: { flex: 1, minWidth: 0, margin: 0, fontSize: 16, lineHeight: '22px', fontWeight: 650 },
  headerButton: {
    width: 30, height: 30, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: colors.text,
    fontSize: 20, cursor: 'pointer',
  },
  list: { flex: 1, minHeight: 0, margin: 0, padding: '6px 0 18px', overflowY: 'auto', listStyle: 'none' },
  chatRow: {
    position: 'relative', width: '100%', minHeight: 66, display: 'flex', alignItems: 'center', gap: 11,
    padding: '8px 14px', boxSizing: 'border-box', border: 0, borderBottom: `1px solid ${colors.border}`,
    background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  chatRowActive: { background: colors.active, boxShadow: `inset 3px 0 ${colors.accent}` },
  chatContent: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  chatTop: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 },
  chatName: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 15, lineHeight: '20px', fontWeight: 500,
  },
  chatTime: { flex: 'none', color: colors.caption, fontSize: 11, lineHeight: '16px' },
  chatBottom: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  preview: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.secondary, fontSize: 12, lineHeight: '17px',
  },
  unread: {
    minWidth: 17, height: 17, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ff5f57',
    color: '#fff', fontSize: 10, lineHeight: '17px',
  },
  privateBadge: { flex: 'none', padding: '1px 6px', borderRadius: 999, background: '#f0f1f2', color: '#777d85', fontSize: 10 },
  avatar: {
    width: 44, height: 44, flex: 'none', position: 'relative', overflow: 'hidden', borderRadius: 999,
    display: 'grid', placeItems: 'center', background: '#eceeef', color: '#727982', fontSize: 15, fontWeight: 600,
  },
  avatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  avatarGrid: { width: '100%', height: '100%', display: 'grid', gap: 1, padding: 2, boxSizing: 'border-box', background: '#eef0f1' },
  selfAvatar: {
    width: 44, height: 44, flex: 'none', position: 'relative', borderRadius: 999,
    background: '#f0f1f2', border: '1px solid #e1e3e5', boxSizing: 'border-box',
  },
  selfBubbleBack: {
    position: 'absolute', left: 15, top: 11, width: 18, height: 14, borderRadius: 7,
    background: '#a9e8bb', boxShadow: '0 0 0 2px #f0f1f2',
  },
  selfBubbleFront: {
    position: 'absolute', left: 10, top: 17, width: 18, height: 14, borderRadius: 7,
    background: '#70d98d', boxShadow: '0 0 0 2px #f0f1f2',
  },
  topicRow: {
    position: 'relative', width: 'calc(100% - 16px)', minHeight: 44, margin: '2px 8px',
    display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', boxSizing: 'border-box',
    border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  topicActive: { background: '#dcf4e8', boxShadow: `inset 4px 0 ${colors.accent}` },
  topicDot: { width: 5, height: 5, flex: 'none', borderRadius: 999, background: '#d6d9dd' },
  topicName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, lineHeight: '22px' },
  topicCount: { flex: 'none', color: colors.caption, fontSize: 13 },
  status: { padding: '20px 18px', color: colors.secondary, fontSize: 12, textAlign: 'center' },
  loginButton: {
    margin: '16px', minHeight: 40, border: 0, borderRadius: 10, background: colors.active,
    color: '#176d3d', cursor: 'pointer', font: 'inherit', fontWeight: 600,
  },
  rail: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 0 6px' },
  railButton: {
    width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 0, borderRadius: 8, outline: 0, background: 'transparent', cursor: 'pointer',
  },
}

const avatarDataUrlCache = new Map<string, Promise<string>>()

function avatarDataUrl(imageRef: string): Promise<string> {
  const cached = avatarDataUrlCache.get(imageRef)
  if (cached !== undefined) return cached
  const pending = callJotmo<JotmoImagePayload>('image.read', { imageRef })
    .then(image => `data:${image.mediaType};base64,${image.dataBase64}`)
    .catch(error => {
      avatarDataUrlCache.delete(imageRef)
      throw error
    })
  avatarDataUrlCache.set(imageRef, pending)
  return pending
}

function initials(value: string): string {
  const normalized = value.trim()
  return normalized === '' ? '即' : [...normalized].slice(-2).join('')
}

function SelfAvatar() {
  return <span style={styles.selfAvatar} aria-hidden>
    <span style={styles.selfBubbleBack} />
    <span style={styles.selfBubbleFront} />
  </span>
}

function SourceAvatar({ source }: { source: JotmoSourceItem }) {
  const container = useRef<HTMLSpanElement>(null)
  const refs = useMemo(
    () => (source.avatarRefs ?? (source.avatarRef === undefined ? [] : [source.avatarRef])).slice(0, 4),
    [source.avatarRef, source.avatarRefs],
  )
  const refsKey = refs.join('|')
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [urls, setUrls] = useState<string[]>([])

  useEffect(() => {
    const target = container.current
    if (target === null || visible) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting !== true) return
      setVisible(true); observer.disconnect()
    }, { rootMargin: '160px 0px' })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [visible])

  useEffect(() => {
    let active = true
    setUrls([])
    if (!visible || refs.length === 0) return () => { active = false }
    void Promise.all(refs.map(async ref => {
      try { return await avatarDataUrl(ref) }
      catch { return '' }
    })).then(values => { if (active) setUrls(values.filter(value => value !== '')) })
    return () => { active = false }
  }, [refsKey, visible])

  const count = urls.length
  const columns = count <= 1 ? 1 : 2
  const rows = count <= 2 ? 1 : 2
  return <span ref={container} style={styles.avatar} aria-hidden>
    {count === 0 ? initials(source.displayName) : count === 1
      ? <img src={urls[0]} alt="" draggable={false} style={styles.avatarImage} />
      : <span style={{ ...styles.avatarGrid, gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {urls.map((url, index) => <img key={`${url.slice(-20)}-${String(index)}`} src={url} alt="" draggable={false} style={styles.avatarImage} />)}
      </span>}
  </span>
}

function timeLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  if (day === start) return time
  if (day === start - 86_400_000) return `昨天 ${time}`
  if (day > start - 7 * 86_400_000) return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

function isSendToSelfSource(source: JotmoSourceItem | undefined): boolean {
  return source?.kind === 'default_category' || source?.kind === 'topic'
}

export function JotmoNavigation({ wide = true, onClose }: JotmoNavigationProps) {
  const ui = useSyncExternalStore(jotmoUi.subscribe, jotmoUi.getSnapshot)
  const [initialCache] = useState(readLastNavigationCache)
  const cacheRef = useRef<JotmoNavigationCache | undefined>(initialCache)
  const authenticatedUserIdRef = useRef<number | undefined>(initialCache?.userId)
  const [auth, setAuth] = useState<JotmoAuthSnapshot>()
  const [directory, setDirectory] = useState<JotmoSourceDirectory>(initialCache?.directory ?? 'send_to_self')
  const [sources, setSources] = useState<JotmoSourceItem[]>(
    initialCache?.sources[initialCache.directory] ?? [],
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const authenticated = auth?.status === 'authenticated'

  const persistCache = useCallback((patch: {
    directory?: JotmoSourceDirectory
    sources?: Partial<Record<JotmoSourceDirectory, JotmoSourceItem[]>>
    selectedSourceRef?: string
  }) => {
    const userId = authenticatedUserIdRef.current
    if (userId === undefined) return
    const current = cacheRef.current?.userId === userId
      ? cacheRef.current
      : { version: 1, userId, directory: 'send_to_self', sources: {}, updatedAtMillis: 0 } satisfies JotmoNavigationCache
    const next: JotmoNavigationCache = {
      ...current,
      directory: patch.directory ?? current.directory,
      sources: { ...current.sources, ...patch.sources },
      updatedAtMillis: Date.now(),
      ...(patch.selectedSourceRef === undefined
        ? (current.selectedSourceRef === undefined ? {} : { selectedSourceRef: current.selectedSourceRef })
        : { selectedSourceRef: patch.selectedSourceRef }),
    }
    cacheRef.current = next
    writeNavigationCache(next)
  }, [])

  const refreshAuth = useCallback(async () => {
    try {
      const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.status')
      setAuth(snapshot)
      if (snapshot.status !== 'authenticated' || snapshot.userId === undefined) {
        authenticatedUserIdRef.current = undefined
        cacheRef.current = undefined
        clearLastNavigationCache()
        setDirectory('send_to_self'); setSources([])
        return
      }
      authenticatedUserIdRef.current = snapshot.userId
      const cached = readNavigationCache(snapshot.userId) ?? {
        version: 1, userId: snapshot.userId, directory: 'send_to_self', sources: {}, updatedAtMillis: 0,
      } satisfies JotmoNavigationCache
      cacheRef.current = cached
      writeNavigationCache(cached)
      setDirectory(cached.directory)
      setSources(cached.sources[cached.directory] ?? [])
      const selected = cachedSelectedSource(cached)
      if (selected !== undefined) jotmoUi.selectSource(selected)
    } catch {
      authenticatedUserIdRef.current = undefined
      cacheRef.current = undefined
      clearLastNavigationCache()
      setAuth({ status: 'logged-out', environment: 'test' })
      setDirectory('send_to_self'); setSources([])
    }
  }, [])

  const loadDirectory = useCallback(async (next: JotmoSourceDirectory) => {
    setLoading(true); setError('')
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
      const selectedSourceRef = jotmoUi.getSnapshot().selectedSource?.sourceRef
      persistCache({
        directory: next,
        sources: { [next]: loaded },
        ...(selectedSourceRef === undefined ? {} : { selectedSourceRef }),
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally { setLoading(false) }
  }, [persistCache])

  useEffect(() => {
    avatarDataUrlCache.clear()
    void refreshAuth()
  }, [refreshAuth, ui.authRevision])
  useEffect(() => {
    if (authenticated) void loadDirectory(directory)
    else setSources([])
  }, [authenticated, directory, loadDirectory])
  useEffect(() => {
    if (!authenticated || directory !== 'send_to_self') return
    const defaultCategory = sources.find(source => source.kind === 'default_category')
    if (defaultCategory !== undefined && !isSendToSelfSource(ui.selectedSource)) {
      jotmoUi.selectSource(defaultCategory)
      persistCache({ directory, selectedSourceRef: defaultCategory.sourceRef })
    }
  }, [authenticated, directory, persistCache, sources, ui.selectedSource])

  const showLogin = () => { jotmoUi.showLogin() }
  const changeDirectory = (next: JotmoSourceDirectory) => {
    setDirectory(next)
    setSources(cacheRef.current?.sources[next] ?? [])
    persistCache({ directory: next })
  }
  const selectSource = (source: JotmoSourceItem) => {
    jotmoUi.selectSource(source)
    persistCache({ directory, selectedSourceRef: source.sourceRef })
  }

  if (!wide) {
    return <div style={styles.rail}><button
      type="button" style={styles.railButton} aria-label={authenticated ? '即我' : '即我 · 未登录'}
      title={authenticated ? '即我' : '即我 · 未登录'} onClick={() => { if (!authenticated) showLogin() }}
    ><JotmoMark size={20} /></button></div>
  }

  return <section style={styles.shell} aria-label="即我会话列表">
    {directory === 'send_to_self' && <header style={styles.header}>
      <button
        type="button" style={styles.headerButton} aria-label="返回即我会话列表" title="返回"
        onClick={() => { changeDirectory('root') }}
      >‹</button>
      <h2 style={styles.headerTitle}>发给自己</h2>
      {onClose !== undefined && <button type="button" style={styles.headerButton} aria-label="关闭即我" title="关闭即我" onClick={onClose}>×</button>}
    </header>}

    {!authenticated && auth !== undefined ? <button type="button" style={styles.loginButton} onClick={showLogin}>登录即我</button> : <div
      style={styles.list} role="tree" aria-label={directory === 'send_to_self' ? '发给自己分类' : '即我会话'}
    >
      {directory === 'root' && <>
        <button
          type="button" role="treeitem" aria-selected={isSendToSelfSource(ui.selectedSource)}
          style={{ ...styles.chatRow, ...(isSendToSelfSource(ui.selectedSource) ? styles.chatRowActive : {}) }}
          onClick={() => { changeDirectory('send_to_self') }}
        >
          <SelfAvatar />
          <span style={styles.chatContent}>
            <span style={styles.chatTop}><span style={styles.chatName}>发给自己</span><span style={styles.privateBadge}>私密</span></span>
            <span style={styles.chatBottom}><span style={styles.preview}>默认分类与主题</span></span>
          </span>
        </button>
        {sources.map(source => {
          const selected = ui.selectedSource?.sourceRef === source.sourceRef
          return <button
            key={source.sourceRef} type="button" role="treeitem" aria-selected={selected}
            style={{ ...styles.chatRow, ...(selected ? styles.chatRowActive : {}) }} onClick={() => { selectSource(source) }}
          >
            <SourceAvatar source={source} />
            <span style={styles.chatContent}>
              <span style={styles.chatTop}>
                <span style={styles.chatName}>{source.displayName}</span>
                <span style={styles.chatTime}>{timeLabel(source.activeAtMillis)}</span>
              </span>
              <span style={styles.chatBottom}>
                <span style={styles.preview}>{source.latestPreview ?? (source.kind === 'group_chat' ? '群聊' : '')}</span>
                {source.unreadCount > 0 && <span style={styles.unread}>{source.unreadCount > 99 ? '99+' : source.unreadCount}</span>}
              </span>
            </span>
          </button>
        })}
      </>}

      {directory === 'send_to_self' && sources.map(source => {
        const selected = ui.selectedSource?.sourceRef === source.sourceRef
        return <button
          key={source.sourceRef} type="button" role="treeitem" aria-selected={selected}
          style={{ ...styles.topicRow, ...(selected ? styles.topicActive : {}) }} onClick={() => { selectSource(source) }}
        >
          <span style={styles.topicDot} />
          <span style={styles.topicName}>{source.displayName}</span>
          {source.recordCount !== undefined && <span style={styles.topicCount}>{source.recordCount}</span>}
        </button>
      })}

      {loading && sources.length === 0 && <div style={styles.status}>正在读取…</div>}
      {!loading && error !== '' && <div style={{ ...styles.status, color: '#c2413b' }}>{error}</div>}
    </div>}
  </section>
}
