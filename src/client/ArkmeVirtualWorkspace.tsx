import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type {
  ArkmeAuthSnapshot, ArkmeSourceDirectory, ArkmeSourceItem, ArkmeSourceList,
} from '../types.js'
import { callArkme } from './api.js'
import { ArkmeSourceAvatar, clearArkmeAvatarCache } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'
import { ArkmeOfficialCommunityEntry } from './ArkmeOfficialCommunityEntry.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  cachedSelectedSource, clearLastNavigationCache, readLastNavigationCache,
  readNavigationCache, reconcileSelectedSource, writeNavigationCache, type ArkmeNavigationCache,
} from './navigation-cache.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import {
  type ArkmeSourceSort,
} from './source-list.js'
import { buildArkmeSourceTree, flattenVisibleArkmeSourceTree, sortArkmeSourceTree } from './source-tree.js'

export interface ArkmeNavigationProps {
  wide?: boolean
  onClose?: () => void
  onActivateSurface?: () => void
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
    padding: '0 12px 0 14px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
  },
  headerTitle: { flex: 1, minWidth: 0, margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 500 },
  headerButton: {
    width: 30, height: 30, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: colors.text,
    fontSize: 20, cursor: 'pointer',
  },
  sortControl: {
    position: 'relative', flex: 'none', display: 'inline-flex', alignItems: 'center', color: colors.secondary,
  },
  sortSelect: {
    minWidth: 54, height: 30, padding: '0 18px 0 4px', border: 0, outline: 0,
    appearance: 'none', WebkitAppearance: 'none', background: 'transparent', color: 'inherit',
    font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  sortArrow: {
    position: 'absolute', right: 4, width: 10, height: 10, pointerEvents: 'none',
  },
  list: { flex: 1, minHeight: 0, margin: 0, padding: '6px 0 18px', overflowY: 'auto', listStyle: 'none' },
  chatRow: {
    position: 'relative', width: '100%', minHeight: 60, display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', boxSizing: 'border-box', border: 0, borderBottom: `1px solid ${colors.border}`,
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
    display: 'grid', placeItems: 'center', background: 'transparent', color: '#727982', fontSize: 15, fontWeight: 600,
  },
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
    position: 'relative', width: 'calc(100% - 16px)', minHeight: 38, margin: '1px 8px',
    display: 'flex', alignItems: 'center', boxSizing: 'border-box', overflow: 'hidden',
    borderRadius: 7, background: 'transparent', color: 'inherit',
  },
  topicActive: { background: 'var(--dsw-alias-fill-tertiary, #f1f2f3)' },
  topicGuide: { position: 'absolute', top: 0, bottom: 0, width: 1, background: colors.border, pointerEvents: 'none' },
  topicLead: {
    position: 'relative', zIndex: 1, width: 30, height: 38, flex: 'none', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', padding: 0, border: 0, background: 'transparent',
    color: colors.caption, cursor: 'default', font: 'inherit',
  },
  topicToggle: { cursor: 'pointer' },
  topicChevron: { display: 'inline-block', fontSize: 17, lineHeight: 1, transformOrigin: '50% 50%' },
  topicDot: { width: 5, height: 5, flex: 'none', borderRadius: 999, background: '#d6d9dd' },
  topicSelect: {
    position: 'relative', zIndex: 1, minWidth: 0, minHeight: 38, flex: 1, display: 'flex',
    alignItems: 'center', gap: 10, padding: '0 10px 0 0', border: 0, background: 'transparent',
    color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  topicName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 400 },
  topicCount: { flex: 'none', color: colors.caption, fontSize: 12 },
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

function SelfAvatar() {
  return <span style={styles.selfAvatar} aria-hidden>
    <span style={styles.selfBubbleBack} />
    <span style={styles.selfBubbleFront} />
  </span>
}

export function ArkmeRecordingsRow({ selected, onClick }: { selected: boolean; onClick(): void }) {
  return <button
    type="button"
    role="treeitem"
    aria-selected={selected}
    style={{ ...styles.chatRow, ...(selected ? styles.chatRowActive : {}) }}
    onClick={onClick}
  >
    <span style={styles.avatar} aria-hidden><ArkmeMark size={44} /></span>
    <span style={styles.chatContent}>
      <span style={styles.chatTop}><span style={styles.chatName}>全天候录音</span></span>
      <span style={styles.chatBottom}><span style={styles.preview}>转写、日总结与时间轴</span></span>
    </span>
  </button>
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

function isSendToSelfSource(source: ArkmeSourceItem | undefined): boolean {
  return source?.kind === 'default_category' || source?.kind === 'topic'
}

export function ArkmeNavigation({ wide = true, onClose, onActivateSurface }: ArkmeNavigationProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const chatDirectory = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot)
  const [initialCache] = useState(readLastNavigationCache)
  const cacheRef = useRef<ArkmeNavigationCache | undefined>(initialCache)
  const authenticatedUserIdRef = useRef<number | undefined>(initialCache?.userId)
  const avatarCacheUserIdRef = useRef<number | undefined>(initialCache?.userId)
  const directoryRequestAbortRef = useRef<AbortController>()
  const auth = authState.auth
  const [directory, setDirectory] = useState<ArkmeSourceDirectory>(initialCache?.directory ?? 'send_to_self')
  const [sources, setSources] = useState<ArkmeSourceItem[]>(
    initialCache?.sources[initialCache.directory] ?? [],
  )
  const [collapsedSourceRefs, setCollapsedSourceRefs] = useState<Set<string>>(() => new Set())
  const [sourceSort, setSourceSort] = useState<ArkmeSourceSort>('latest')
  const [error, setError] = useState('')
  const authenticated = auth?.status === 'authenticated'
  const sourceTree = useMemo(
    () => sortArkmeSourceTree(buildArkmeSourceTree(sources), sourceSort),
    [sourceSort, sources],
  )
  const visibleSourceRows = useMemo(
    () => flattenVisibleArkmeSourceTree(sourceTree, collapsedSourceRefs),
    [collapsedSourceRefs, sourceTree],
  )
  const bindingRequired = auth?.status === 'binding-required'

  const persistCache = useCallback((patch: {
    directory?: ArkmeSourceDirectory
    sources?: Partial<Record<ArkmeSourceDirectory, ArkmeSourceItem[]>>
    selectedSourceRef?: string
  }) => {
    const userId = authenticatedUserIdRef.current
    if (userId === undefined) return
    const current = cacheRef.current?.userId === userId
      ? cacheRef.current
      : { version: 1, userId, directory: 'send_to_self', sources: {}, updatedAtMillis: 0 } satisfies ArkmeNavigationCache
    const next: ArkmeNavigationCache = {
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

  const reconcileAuth = useCallback((snapshot: ArkmeAuthSnapshot | undefined) => {
      if (snapshot?.status !== 'authenticated' || snapshot.userId === undefined) {
        if (avatarCacheUserIdRef.current !== undefined) clearArkmeAvatarCache()
        avatarCacheUserIdRef.current = undefined
        authenticatedUserIdRef.current = undefined
        cacheRef.current = undefined
        clearLastNavigationCache()
        setDirectory('send_to_self'); setSources([])
        return
      }
    if (avatarCacheUserIdRef.current !== snapshot.userId) clearArkmeAvatarCache()
    avatarCacheUserIdRef.current = snapshot.userId
    authenticatedUserIdRef.current = snapshot.userId
    const cached = readNavigationCache(snapshot.userId) ?? {
      version: 1, userId: snapshot.userId, directory: 'send_to_self', sources: {}, updatedAtMillis: 0,
    } satisfies ArkmeNavigationCache
    cacheRef.current = cached
    writeNavigationCache(cached)
    setDirectory(cached.directory)
    setSources(cached.sources[cached.directory] ?? [])
  }, [])

  const loadDirectory = useCallback(async (next: ArkmeSourceDirectory) => {
    const controller = new AbortController()
    directoryRequestAbortRef.current?.abort()
    directoryRequestAbortRef.current = controller
    setError('')
    try {
      const loaded: ArkmeSourceItem[] = []
      let cursor: string | undefined
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await callArkme<ArkmeSourceList>('sources.list', {
          directory: next,
          limit: next === 'root' ? 50 : 100,
          ...(cursor === undefined ? {} : { cursor }),
        }, controller.signal)
        const known = new Set(loaded.map(item => item.sourceRef))
        loaded.push(...page.items.filter(item => !known.has(item.sourceRef)))
        if (!page.hasMore || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      if (controller.signal.aborted) return
      setSources(loaded)
      const uiSnapshot = arkmeUi.getSnapshot()
      const selected = uiSnapshot.mode === 'recordings' ? undefined : uiSnapshot.selectedSource
      const cachedSelected = cacheRef.current === undefined ? undefined : cachedSelectedSource(cacheRef.current)
      const restored = uiSnapshot.mode === 'recordings'
        ? undefined
        : reconcileSelectedSource(selected ?? cachedSelected, loaded)
        ?? (next === 'send_to_self' ? loaded.find(source => source.kind === 'default_category') : undefined)
      if (restored !== undefined) arkmeUi.selectSource(restored)
      persistCache({
        directory: next,
        sources: { [next]: loaded },
        ...(restored === undefined ? {} : { selectedSourceRef: restored.sourceRef }),
      })
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (directoryRequestAbortRef.current === controller) directoryRequestAbortRef.current = undefined
    }
  }, [persistCache])

  useEffect(() => {
    void arkmeAuthStore.refresh().catch(() => undefined)
  }, [ui.authRevision])
  useEffect(() => { reconcileAuth(auth) }, [auth, reconcileAuth])
  useEffect(() => {
    if (authenticated) void loadDirectory(directory)
    else { directoryRequestAbortRef.current?.abort(); setSources([]) }
    return () => { directoryRequestAbortRef.current?.abort() }
  }, [authenticated, directory, loadDirectory])
  useEffect(() => {
    if (!authenticated || directory !== 'root' || chatDirectory.revision === 0) return
    const loaded = chatDirectory.sources
    setSources(loaded)
    const selected = ui.mode === 'recordings' ? undefined : arkmeUi.getSnapshot().selectedSource
    const cachedSelected = cacheRef.current === undefined ? undefined : cachedSelectedSource(cacheRef.current)
    const restored = ui.mode === 'recordings'
      ? undefined
      : reconcileSelectedSource(selected ?? cachedSelected, loaded)
    if (restored !== undefined) arkmeUi.selectSource(restored)
    persistCache({
      directory: 'root',
      sources: { root: loaded },
      ...(restored === undefined ? {} : { selectedSourceRef: restored.sourceRef }),
    })
  }, [authenticated, chatDirectory, directory, persistCache, ui.mode])
  useEffect(() => {
    if (!authenticated || directory !== 'send_to_self') return
    const defaultCategory = sources.find(source => source.kind === 'default_category')
    if (defaultCategory !== undefined && !isSendToSelfSource(ui.selectedSource)) {
      arkmeUi.selectSource(defaultCategory)
      persistCache({ directory, selectedSourceRef: defaultCategory.sourceRef })
      onActivateSurface?.()
    }
  }, [authenticated, directory, onActivateSurface, persistCache, sources, ui.selectedSource])
  useEffect(() => {
    const sourcesByRef = new Map(sources.map(source => [source.sourceRef, source]))
    setCollapsedSourceRefs(current => {
      const next = new Set([...current].filter(sourceRef => sourcesByRef.has(sourceRef)))
      let parentRef = ui.selectedSource === undefined
        ? undefined
        : sourcesByRef.get(ui.selectedSource.sourceRef)?.parentSourceRef
      const visited = new Set<string>()
      while (parentRef !== undefined && !visited.has(parentRef)) {
        visited.add(parentRef)
        next.delete(parentRef)
        parentRef = sourcesByRef.get(parentRef)?.parentSourceRef
      }
      if (next.size === current.size && [...next].every(sourceRef => current.has(sourceRef))) return current
      return next
    })
  }, [sources, ui.selectedSource])
  const showLogin = () => { arkmeUi.showLogin(); onActivateSurface?.() }
  const showRecordings = () => { arkmeUi.showRecordings(); onActivateSurface?.() }
  const changeDirectory = (next: ArkmeSourceDirectory) => {
    directoryRequestAbortRef.current?.abort()
    setDirectory(next)
    setSources(cacheRef.current?.sources[next] ?? [])
    persistCache({ directory: next })
  }
  const selectSource = (source: ArkmeSourceItem) => {
    arkmeUi.selectSource(source)
    persistCache({ directory, selectedSourceRef: source.sourceRef })
    onActivateSurface?.()
  }
  const toggleSource = (sourceRef: string) => {
    setCollapsedSourceRefs(current => {
      const next = new Set(current)
      if (next.has(sourceRef)) next.delete(sourceRef)
      else next.add(sourceRef)
      return next
    })
  }
  const joinedOfficialCommunity = async (source: ArkmeSourceItem): Promise<void> => {
    const sharedSources = arkmeChatDirectory.getSnapshot().sources
    const currentSources = sharedSources.length > 0 ? sharedSources : sources
    const nextSources = [source, ...currentSources.filter(item => item.sourceRef !== source.sourceRef)]
    setSources(nextSources)
    arkmeChatDirectory.publish(nextSources)
    arkmeUi.selectSource(source)
    persistCache({ directory: 'root', sources: { root: nextSources }, selectedSourceRef: source.sourceRef })
    onActivateSurface?.()
    await loadDirectory('root')
  }

  if (!wide) {
    return <div style={styles.rail}><button
      type="button" style={styles.railButton} aria-label={authenticated ? 'Arkme' : bindingRequired ? 'Arkme · 待绑定' : 'Arkme · 未登录'}
      title={authenticated ? 'Arkme' : bindingRequired ? 'Arkme · 待绑定' : 'Arkme · 未登录'} onClick={() => { if (!authenticated) showLogin() }}
    ><ArkmeMark size={20} /></button></div>
  }

  return <section style={styles.shell} aria-label="Arkme 会话列表">
    {directory === 'send_to_self' && <header style={styles.header}>
      <button
        type="button" style={styles.headerButton} aria-label="返回 Arkme 会话列表" title="返回"
        onClick={() => { changeDirectory('root') }}
      >‹</button>
      <h2 style={styles.headerTitle}>发给自己</h2>
      <label style={styles.sortControl}>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>排序</span>
        <select
          style={styles.sortSelect} aria-label="发给自己排序" value={sourceSort}
          onChange={event => { setSourceSort(event.currentTarget.value as ArkmeSourceSort) }}
        >
          <option value="latest">最新</option>
          <option value="most">最多</option>
          <option value="name">名称</option>
        </select>
        <svg aria-hidden viewBox="0 0 10 10" style={styles.sortArrow}>
          <path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </label>
      {onClose !== undefined && <button type="button" style={styles.headerButton} aria-label="关闭 Arkme" title="关闭 Arkme" onClick={onClose}>×</button>}
    </header>}

    {!authenticated && auth !== undefined ? <button type="button" style={styles.loginButton} onClick={showLogin}>
      {bindingRequired ? '完成登录' : '登录 Arkme'}
    </button> : <div
      style={styles.list} role="tree"
      aria-label={directory === 'send_to_self' ? '发给自己分类' : 'Arkme 会话'}
    >
      {directory === 'root' && <>
        {authenticated && <ArkmeOfficialCommunityEntry onJoined={joinedOfficialCommunity} />}
        <button
          type="button" role="treeitem" aria-selected={ui.mode === 'source' && isSendToSelfSource(ui.selectedSource)}
          style={{ ...styles.chatRow, ...(ui.mode === 'source' && isSendToSelfSource(ui.selectedSource) ? styles.chatRowActive : {}) }}
          onClick={() => {
            changeDirectory('send_to_self')
            if (ui.mode === 'source' && isSendToSelfSource(ui.selectedSource)) onActivateSurface?.()
          }}
        >
          <SelfAvatar />
          <span style={styles.chatContent}>
            <span style={styles.chatTop}><span style={styles.chatName}>发给自己</span><span style={styles.privateBadge}>私密</span></span>
            <span style={styles.chatBottom}><span style={styles.preview}>默认分类与主题</span></span>
          </span>
        </button>
        <ArkmeRecordingsRow selected={ui.mode === 'recordings'} onClick={showRecordings} />
        {sources.map(source => {
          const selected = ui.mode === 'source' && ui.selectedSource?.sourceRef === source.sourceRef
          return <button
            key={source.sourceRef} type="button" role="treeitem" aria-selected={selected}
            style={{ ...styles.chatRow, ...(selected ? styles.chatRowActive : {}) }} onClick={() => { selectSource(source) }}
          >
            <ArkmeSourceAvatar
              {...(source.avatarRef === undefined ? {} : { avatarRef: source.avatarRef })}
              {...(source.avatarRefs === undefined ? {} : { avatarRefs: source.avatarRefs })}
            />
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

      {directory === 'send_to_self' && visibleSourceRows.map(row => {
        const source = row.source
        const selected = ui.mode === 'source' && ui.selectedSource?.sourceRef === source.sourceRef
        return <div
          key={source.sourceRef} role="treeitem" aria-level={row.depth + 1} aria-selected={selected}
          aria-expanded={row.hasChildren ? row.expanded : undefined}
          style={{ ...styles.topicRow, ...(selected ? styles.topicActive : {}) }}
        >
          {Array.from({ length: row.depth }, (_, index) => <span
            key={index} aria-hidden style={{ ...styles.topicGuide, left: 21 + index * 20 }}
          />)}
          {row.hasChildren ? <button
            type="button"
            style={{ ...styles.topicLead, ...styles.topicToggle, marginLeft: 6 + row.depth * 20 }}
            aria-label={`${row.expanded ? '收起' : '展开'}${source.displayName}`}
            title={row.expanded ? '收起子主题' : '展开子主题'}
            onClick={() => { toggleSource(source.sourceRef) }}
          ><span aria-hidden style={{ ...styles.topicChevron, transform: row.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span></button> : <span
            aria-hidden style={{ ...styles.topicLead, marginLeft: 6 + row.depth * 20 }}
          ><span style={styles.topicDot} /></span>}
          <button type="button" style={styles.topicSelect} onClick={() => { selectSource(source) }}>
            <span style={styles.topicName}>{source.displayName}</span>
            {source.recordCount !== undefined && <span style={styles.topicCount}>{source.recordCount}</span>}
          </button>
        </div>
      })}

      {error !== '' && <div style={{ ...styles.status, color: '#c2413b' }}>{error}</div>}
    </div>}
  </section>
}
