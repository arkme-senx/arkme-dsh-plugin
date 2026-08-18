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
  arkmeSourceTimeLabel, sortArkmeSources, type ArkmeSourceSort,
} from './source-list.js'

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
  sourceCard: {
    width: 'calc(100% - 16px)', minHeight: 56, margin: '6px 8px 0', padding: '8px 10px',
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 3, boxSizing: 'border-box',
    overflow: 'hidden', border: 0, borderRadius: 8,
    background: 'var(--dsw-alias-fill-secondary, #f4f4f5)', color: 'inherit',
    textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  sourceCardActive: {
    background: 'var(--dsw-alias-fill-tertiary, #e9f4ee)', boxShadow: `inset 3px 0 ${colors.accent}`,
  },
  sourceCardName: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 14, lineHeight: '20px', fontWeight: 400,
  },
  sourceCardMeta: {
    minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, color: colors.secondary,
    fontSize: 12, lineHeight: '17px',
  },
  sourceCardCount: {
    minWidth: 18, height: 17, padding: '0 4px', boxSizing: 'border-box', borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
    background: 'var(--dsw-alias-fill-tertiary, #e9eaec)', color: colors.secondary,
  },
  sourceCardPreview: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
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
  const [sourceSort, setSourceSort] = useState<ArkmeSourceSort>('latest')
  const [error, setError] = useState('')
  const authenticated = auth?.status === 'authenticated'
  const sortedSources = useMemo(() => sortArkmeSources(sources, sourceSort), [sourceSort, sources])
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
      style={styles.list} role={directory === 'send_to_self' ? 'listbox' : 'tree'}
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

      {directory === 'send_to_self' && sortedSources.map(source => {
        const selected = ui.mode === 'source' && ui.selectedSource?.sourceRef === source.sourceRef
        const time = arkmeSourceTimeLabel(source.activeAtMillis)
        const preview = [time, source.latestPreview].filter(value => value !== undefined && value !== '').join(' · ')
        return <button
          key={source.sourceRef} type="button" role="option" aria-selected={selected}
          style={{ ...styles.sourceCard, ...(selected ? styles.sourceCardActive : {}) }}
          onClick={() => { selectSource(source) }}
        >
          <span style={styles.sourceCardName}>{source.displayName}</span>
          {(source.recordCount !== undefined || preview !== '') && <span style={styles.sourceCardMeta}>
            {source.recordCount !== undefined && <span style={styles.sourceCardCount}>{source.recordCount}</span>}
            {preview !== '' && <span style={styles.sourceCardPreview}>{preview}</span>}
          </span>}
        </button>
      })}

      {error !== '' && <div style={{ ...styles.status, color: '#c2413b' }}>{error}</div>}
    </div>}
  </section>
}
