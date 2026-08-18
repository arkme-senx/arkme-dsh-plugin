import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type {
  ArkmeAuthSnapshot, ArkmeSourceDirectory, ArkmeSourceItem, ArkmeSourceList,
} from '../types.js'
import { callArkme } from './api.js'
import { ArkmeSourceAvatar, clearArkmeAvatarCache } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'
import { ArkmeOfficialCommunityEntry } from './ArkmeOfficialCommunityEntry.js'
import {
  cachedSelectedSource, clearLastNavigationCache, readLastNavigationCache,
  readNavigationCache, reconcileSelectedSource, writeNavigationCache, type ArkmeNavigationCache,
} from './navigation-cache.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeChatDirectory } from './chat-directory-store.js'

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
    display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', boxSizing: 'border-box',
    border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  topicActive: { background: '#dcf4e8', boxShadow: `inset 4px 0 ${colors.accent}` },
  topicDot: { width: 5, height: 5, flex: 'none', borderRadius: 999, background: '#d6d9dd' },
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
  const chatDirectory = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot)
  const [initialCache] = useState(readLastNavigationCache)
  const cacheRef = useRef<ArkmeNavigationCache | undefined>(initialCache)
  const authenticatedUserIdRef = useRef<number | undefined>(initialCache?.userId)
  const avatarCacheUserIdRef = useRef<number | undefined>(initialCache?.userId)
  const directoryRequestAbortRef = useRef<AbortController>()
  const [auth, setAuth] = useState<ArkmeAuthSnapshot>()
  const [directory, setDirectory] = useState<ArkmeSourceDirectory>(initialCache?.directory ?? 'send_to_self')
  const [sources, setSources] = useState<ArkmeSourceItem[]>(
    initialCache?.sources[initialCache.directory] ?? [],
  )
  const [error, setError] = useState('')
  const authenticated = auth?.status === 'authenticated'

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

  const refreshAuth = useCallback(async () => {
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.status')
      setAuth(snapshot)
      if (snapshot.status !== 'authenticated' || snapshot.userId === undefined) {
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
    } catch {
      if (avatarCacheUserIdRef.current !== undefined) clearArkmeAvatarCache()
      avatarCacheUserIdRef.current = undefined
      authenticatedUserIdRef.current = undefined
      cacheRef.current = undefined
      clearLastNavigationCache()
      setAuth({ status: 'logged-out', environment: 'test' })
      setDirectory('send_to_self'); setSources([])
    }
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
      const selected = arkmeUi.getSnapshot().selectedSource
      const cachedSelected = cacheRef.current === undefined ? undefined : cachedSelectedSource(cacheRef.current)
      const restored = reconcileSelectedSource(selected ?? cachedSelected, loaded)
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
    void refreshAuth()
  }, [refreshAuth, ui.authRevision])
  useEffect(() => {
    if (authenticated) void loadDirectory(directory)
    else { directoryRequestAbortRef.current?.abort(); setSources([]) }
    return () => { directoryRequestAbortRef.current?.abort() }
  }, [authenticated, directory, loadDirectory])
  useEffect(() => {
    if (!authenticated || directory !== 'root' || chatDirectory.revision === 0) return
    const loaded = chatDirectory.sources
    setSources(loaded)
    const selected = arkmeUi.getSnapshot().selectedSource
    const cachedSelected = cacheRef.current === undefined ? undefined : cachedSelectedSource(cacheRef.current)
    const restored = reconcileSelectedSource(selected ?? cachedSelected, loaded)
    if (restored !== undefined) arkmeUi.selectSource(restored)
    persistCache({
      directory: 'root',
      sources: { root: loaded },
      ...(restored === undefined ? {} : { selectedSourceRef: restored.sourceRef }),
    })
  }, [authenticated, chatDirectory, directory, persistCache])
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
      type="button" style={styles.railButton} aria-label={authenticated ? 'Arkme' : 'Arkme · 未登录'}
      title={authenticated ? 'Arkme' : 'Arkme · 未登录'} onClick={() => { if (!authenticated) showLogin() }}
    ><ArkmeMark size={20} /></button></div>
  }

  return <section style={styles.shell} aria-label="Arkme 会话列表">
    {directory === 'send_to_self' && <header style={styles.header}>
      <button
        type="button" style={styles.headerButton} aria-label="返回 Arkme 会话列表" title="返回"
        onClick={() => { changeDirectory('root') }}
      >‹</button>
      <h2 style={styles.headerTitle}>发给自己</h2>
      {onClose !== undefined && <button type="button" style={styles.headerButton} aria-label="关闭 Arkme" title="关闭 Arkme" onClick={onClose}>×</button>}
    </header>}

    {!authenticated && auth !== undefined ? <button type="button" style={styles.loginButton} onClick={showLogin}>登录 Arkme</button> : <div
      style={styles.list} role="tree" aria-label={directory === 'send_to_self' ? '发给自己分类' : 'Arkme 会话'}
    >
      {directory === 'root' && <>
        {authenticated && <ArkmeOfficialCommunityEntry onJoined={joinedOfficialCommunity} />}
        <button
          type="button" role="treeitem" aria-selected={isSendToSelfSource(ui.selectedSource)}
          style={{ ...styles.chatRow, ...(isSendToSelfSource(ui.selectedSource) ? styles.chatRowActive : {}) }}
          onClick={() => {
            changeDirectory('send_to_self')
            if (isSendToSelfSource(ui.selectedSource)) onActivateSurface?.()
          }}
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

      {error !== '' && <div style={{ ...styles.status, color: '#c2413b' }}>{error}</div>}
    </div>}
  </section>
}
