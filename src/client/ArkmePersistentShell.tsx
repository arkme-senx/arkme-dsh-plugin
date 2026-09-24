import { tr, useArkmeLocale } from './locale.js'
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ReactNode, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './slots-contract.js'
import type { ArkmeAuthSnapshot, ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { ArkmeHomeTour } from './ArkmeHomeTour.js'
import { startArkmeDirectoryBadge } from './directory-badge-runtime.js'
import { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
import { ArkmeQuickAddButton } from './ArkmeQuickAdd.js'
import { arkmePrependSourceByIdentity } from './source-identity.js'
import { ArkmeSurface } from './ArkmeSidebar.js'
import { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
import type { ArkmeDshMessageSearchResult } from './ArkmeSearchSurface.js'
import { ARKME_DEFAULT_SHARE_WEBSITE } from '../types.js'
import { ContactDirectoryAddDialog } from './redesign/contacts/ContactDirectoryAddDialog.js'
import { ContactDirectorySurface } from './redesign/contacts/ContactDirectorySurface.js'
import { DirectoryDetailPane } from './redesign/contacts/DirectoryDetailPane.js'
import { UnmarkedSpeakerDetail } from './redesign/contacts/UnmarkedSpeakerDetail.js'
import { arkmeContactsTab } from './redesign/contacts/contacts-tab-store.js'
import { callArkme } from './api.js'
import { DeepSeekHarnessSurface } from './DeepSeekHarnessSurface.js'
import { startupAuthGateEnabled } from './ArkmeStartupAuthGate.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeAvatarImages } from './avatar-image-runtime.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmePresentationMaintenance } from './presentation-maintenance-runtime.js'
import { useArkmeRealtimeClientEvents } from './realtime-client-events.js'
import { arkmeUi } from './ui-controller.js'
import { ARKME_LOGIN_LOCALE_NAMESPACE } from './arkme-login-locales.js'
import { ArkmeExtensionRecoveryNotice } from './ArkmeExtensionRecoveryNotice.js'
import { ARKME_NAVIGATION_WIDTH } from './arkme-layout.js'

const styles: Record<string, CSSProperties> = {
  sidebar: {
    position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    display: 'flex', overflow: 'hidden', background: '#fff',
  },
  taskDirectory: { minWidth: 0, flex: 1, overflow: 'hidden', borderLeft: '1px solid #ececef', background: '#fff' },
  sidebarResizeHandle: {
    // Share the 4px divider budget with taskDirectory's 1px border. Keeping
    // this in the flex layout leaves the native scrollbar fully hit-testable.
    position: 'relative', zIndex: 3, alignSelf: 'stretch', flex: '0 0 3px', width: 3,
    cursor: 'ew-resize', touchAction: 'none',
  },
  workspace: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff', position: 'relative',
  },
  conversationLayer: {
    position: 'absolute', inset: 0, minWidth: 0, minHeight: 0,
  },
  contactsLayer: {
    position: 'absolute', inset: 0, zIndex: 2,
  },
  details: { width: 0, height: 0, overflow: 'hidden' },
}

// Keep directory width independent of the navigation rail and its 4px divider budget.
const ARKME_PERSISTENT_DIVIDER_BUDGET = 4
const ARKME_PERSISTENT_SIDEBAR_CHROME_WIDTH = ARKME_NAVIGATION_WIDTH + ARKME_PERSISTENT_DIVIDER_BUDGET
const ARKME_PERSISTENT_DIRECTORY_MIN_WIDTH = 120
const ARKME_PERSISTENT_DIRECTORY_COMPACT_WIDTH = 200
const ARKME_PERSISTENT_SIDEBAR_MIN_WIDTH = ARKME_PERSISTENT_SIDEBAR_CHROME_WIDTH
  + ARKME_PERSISTENT_DIRECTORY_MIN_WIDTH
const ARKME_PERSISTENT_DIRECTORY_MAX_WIDTH = 404
const ARKME_PERSISTENT_SIDEBAR_MAX_WIDTH = ARKME_PERSISTENT_DIRECTORY_MAX_WIDTH + ARKME_PERSISTENT_SIDEBAR_CHROME_WIDTH
const ARKME_PERSISTENT_DIRECTORY_WIDTH_STORAGE_KEY = 'dsh-arkme:persistent-directory-width:v2'
const ARKME_LEGACY_SIDEBAR_WIDTH_STORAGE_KEY = 'dsh-arkme:persistent-sidebar-width:v1'
const ARKME_LEGACY_SIDEBAR_CHROME_WIDTH = 76

type PersistentSidebarStorage = Pick<Storage, 'getItem' | 'setItem'>

export function clampPersistentSidebarWidth(width: number): number {
  return Math.min(ARKME_PERSISTENT_SIDEBAR_MAX_WIDTH, Math.max(ARKME_PERSISTENT_SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function browserPersistentSidebarStorage(): PersistentSidebarStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

export function readPersistentSidebarWidth(storage: PersistentSidebarStorage | undefined = browserPersistentSidebarStorage()): number | undefined {
  if (storage === undefined) return undefined
  try {
    const directoryRaw = storage.getItem(ARKME_PERSISTENT_DIRECTORY_WIDTH_STORAGE_KEY)
    const raw = directoryRaw ?? storage.getItem(ARKME_LEGACY_SIDEBAR_WIDTH_STORAGE_KEY)
    if (raw === null || raw.trim() === '') return undefined
    const parsed = Number(raw)
    const directoryWidth = parsed - (directoryRaw === null ? ARKME_LEGACY_SIDEBAR_CHROME_WIDTH : 0)
    return Number.isFinite(parsed) ? clampPersistentSidebarWidth(directoryWidth + ARKME_PERSISTENT_SIDEBAR_CHROME_WIDTH) : undefined
  } catch { return undefined }
}

export function writePersistentSidebarWidth(width: number, storage: PersistentSidebarStorage | undefined = browserPersistentSidebarStorage()): void {
  if (storage === undefined) return
  try { storage.setItem(ARKME_PERSISTENT_DIRECTORY_WIDTH_STORAGE_KEY, String(clampPersistentSidebarWidth(width) - ARKME_PERSISTENT_SIDEBAR_CHROME_WIDTH)) }
  catch { /* Browser privacy settings may make localStorage unavailable. */ }
}

export function resolvePersistentSidebarWidth(
  collapsed: boolean,
  hostWidth: number,
  preferredWidth?: number,
  compactWidthOverride?: number,
): number {
  if (collapsed) return compactWidthOverride === undefined
    ? ARKME_PERSISTENT_SIDEBAR_MIN_WIDTH
    : clampPersistentSidebarWidth(compactWidthOverride)
  return preferredWidth === undefined ? clampPersistentSidebarWidth(hostWidth) : clampPersistentSidebarWidth(preferredWidth)
}

/** Permanent browser-side lifecycles that used to be owned by the optional DSH footer entry. */
export function ArkmePersistentClientRuntime() {
  useArkmeLocale()
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const auth = authState.auth
  const avatarScopeKey = auth?.status === 'authenticated'
    ? `${auth.environment}:${String(auth.userId)}`
    : undefined
  const homeTourRouteActive = ui.calendarOpen !== true && (
    ui.mode === 'harness' || ui.mode === 'arko' || ui.mode === 'bot'
    || (ui.mode === 'source' && ui.productMode !== 'contacts')
  )

  useLayoutEffect(() => { arkmeAvatarImages.activateScope(avatarScopeKey) }, [avatarScopeKey])
  useEffect(() => {
    if (avatarScopeKey === undefined) return
    return arkmePresentationMaintenance.start()
  }, [avatarScopeKey])

  useArkmeRealtimeClientEvents(auth, ui.authRevision, true, { ownsMessagePreparing: true })

  useEffect(() => {
    if (typeof window === 'undefined' || window.top !== window) return
    const bridge = window.arkmeDesktopNotifications
    if (bridge?.applyDirectoryBadge === undefined) return
    return startArkmeDirectoryBadge(count => bridge.applyDirectoryBadge!(count), avatarScopeKey)
  }, [avatarScopeKey])

  useEffect(() => {
    if (!shouldRestoreWebAuthenticatedWorkspace(auth, ui.mode)) return
    arkmeUi.authChanged(true, true)
  }, [auth, ui.mode])

  return <>
    <ArkmeOutgoingCallHost />
    <ArkmeHomeTour auth={auth}
      blocked={ui.mode === 'login' || ui.webLoginDialogOpen === true}
      routeActive={homeTourRouteActive}
      notificationRevision={ui.notificationActivationRevision ?? 0} />
  </>
}

/** The persistent shell remains mounted even when a transient Web login dialog has already unmounted. */
export function shouldRestoreWebAuthenticatedWorkspace(
  auth: ArkmeAuthSnapshot | undefined,
  mode: string,
  desktopStartupGate = startupAuthGateEnabled(),
): boolean {
  return !desktopStartupGate && auth?.status === 'authenticated' && mode === 'login'
}

export type ArkmePersistentSidebarProps = PropsRuntime<'sidebar'>
  & PropsRenderSlots<'arkme.directory.entry' | 'arkme.send-to-self.entry' | 'arkme.topic.actions'>
  & {
    collapseSidebar(): void
    closeDetails(): void
    searchDshMessages?(query: string, signal: AbortSignal): Promise<{ items: SessionSearchResultItem[]; hasMore: boolean }>
    openDshSession?(sessionId: string): void
  }

/** Only the two directory panels are retained; account keys delimit their lifetime. */
function PersistentDirectoryPanel({ active, mode, children }: { active: boolean; mode: 'contacts' | 'conversations'; children: ReactNode }) {
  useArkmeLocale()
  const [visited, setVisited] = useState(active)
  useEffect(() => { if (active) setVisited(true) }, [active])
  if (!active && !visited) return null
  return <div hidden={!active} aria-hidden={!active || undefined}
    style={{ ...styles.taskDirectory, ...(active ? {} : { display: 'none' }) }}
    data-arkme-directory-mode={active ? mode : undefined} data-arkme-retained-directory={mode}>
    {children}
  </div>
}

/** Arkme permanently owns the DSH sidebar seat. */
export function ArkmePersistentSidebar({
  collapsed, width, useSessions, renderSlot, closeDetails,
  searchDshMessages = async () => ({ items: [], hasMore: false }), openDshSession = () => undefined,
}: ArkmePersistentSidebarProps) {
  useArkmeLocale()
  const sessionState = useSessions(state => state)
  const directorySnapshot = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot, arkmeChatDirectory.getSnapshot)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const recordRevision = useSyncExternalStore(
    arkmeUi.subscribe, arkmeUi.getRecordRevision, arkmeUi.getRecordRevision,
  )
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const harnessMode = ui.mode === 'harness'
  const loginMode = ui.mode === 'login'
    || (authState.auth !== undefined && authState.auth.status !== 'authenticated')
  const webLockedMode = loginMode && !startupAuthGateEnabled()
  const authenticatedUserId = authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined
  const contactsAccountKey = authState.auth?.status === 'authenticated' ? `${authState.auth.environment}:${String(authState.auth.userId)}` : undefined
  const contacts = useSyncExternalStore(arkmeContactsTab.subscribe, arkmeContactsTab.getSnapshot, arkmeContactsTab.getSnapshot)
  const scopedContacts = arkmeContactsTab.getSnapshotForAccount(contactsAccountKey)
  const contactsDirectoryCache = arkmeContactsTab.getDirectoryCache(contactsAccountKey)
  const contactsMode = ui.mode === 'source' && ui.productMode === 'contacts'
  const contactsContextRef = useRef({ accountKey: contactsAccountKey, contactsMode })
  contactsContextRef.current = { accountKey: contactsAccountKey, contactsMode }
  const [contactAddSession, setContactAddSession] = useState<{ accountKey: string | undefined }>()
  const [contactsAddedRevision, setContactsAddedRevision] = useState(0)
  useEffect(() => {
    if (!contactsMode || loginMode || ui.calendarOpen === true || contactAddSession?.accountKey !== contactsAccountKey) {
      setContactAddSession(undefined)
    }
  }, [contactsMode, loginMode, ui.calendarOpen, contactsAccountKey, contactAddSession])
  const [sendToSelfState, setSendToSelfState] = useState<{
    userId: number
    source: ArkmeSourceItem
  }>()
  const directoryVisible = !loginMode && ui.calendarOpen !== true
    && (ui.mode === 'source' || ui.mode === 'bot' || ui.mode === 'arko' || harnessMode)
  const [preferredSidebarWidth, setPreferredSidebarWidth] = useState<number | undefined>(() => readPersistentSidebarWidth())
  const [compactSidebarWidthOverride, setCompactSidebarWidthOverride] = useState<number>()
  const sidebarResizeRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    compact: boolean
    lastWidth: number
  }>()
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const hostSidebarWidth = clampPersistentSidebarWidth(width + ARKME_PERSISTENT_SIDEBAR_CHROME_WIDTH)
  const renderedSidebarWidth = resolvePersistentSidebarWidth(
    collapsed, hostSidebarWidth, preferredSidebarWidth, compactSidebarWidthOverride,
  )
  const renderedDirectoryWidth = renderedSidebarWidth - ARKME_PERSISTENT_SIDEBAR_CHROME_WIDTH
  const compactDirectory = !contactsMode && renderedDirectoryWidth <= ARKME_PERSISTENT_DIRECTORY_COMPACT_WIDTH
  useEffect(() => {
    if (authenticatedUserId === undefined) {
      setSendToSelfState(undefined)
      return
    }
    const controller = new AbortController()
    void callArkme<ArkmeSourceList>('sources.list', {
      directory: 'send_to_self', limit: 100,
    }, controller.signal).then(page => {
      const source = page.items.find(item => item.kind === 'send_to_self')
      if (source !== undefined && !controller.signal.aborted) {
        setSendToSelfState({ userId: authenticatedUserId, source })
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [authenticatedUserId, recordRevision])
  const sendToSelfSource = sendToSelfState !== undefined && sendToSelfState.userId === authenticatedUserId
    ? sendToSelfState.source
    : directorySnapshot.projection?.sendToSelf
  const searchDsh = useCallback(async (query: string, signal: AbortSignal): Promise<ArkmeDshMessageSearchResult> => {
    const result = await searchDshMessages(query, signal)
    return {
      hasMore: result.hasMore,
      items: result.items.map(item => {
        const summary = sessionState.byId[item.sessionId]
        return {
          sessionId: item.sessionId,
          title: summary?.displayTitle ?? 'DeepSeek Harness 任务',
          snippet: item.snippet,
          updatedAtMillis: summary?.updatedAt ?? 0,
        }
      }),
    }
  }, [searchDshMessages, sessionState.byId])
  useLayoutEffect(() => {
    closeDetails()
  }, [closeDetails])
  useEffect(() => {
    if (!collapsed) setCompactSidebarWidthOverride(undefined)
  }, [collapsed])
  useLayoutEffect(() => { arkmeContactsTab.activateAccount(contactsAccountKey) }, [contactsAccountKey])
  useEffect(() => () => {
    contactsContextRef.current = { ...contactsContextRef.current, contactsMode: false }
  }, [])

  const beginSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    sidebarResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: renderedSidebarWidth,
      compact: collapsed,
      lastWidth: renderedSidebarWidth,
    }
    setSidebarResizing(true)
  }, [collapsed, renderedSidebarWidth])
  const continueSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = sidebarResizeRef.current
    if (resize === undefined || resize.pointerId !== event.pointerId) return
    const nextWidth = clampPersistentSidebarWidth(resize.startWidth + event.clientX - resize.startX)
    resize.lastWidth = nextWidth
    if (resize.compact) setCompactSidebarWidthOverride(nextWidth)
    else setPreferredSidebarWidth(nextWidth)
  }, [])
  const stopSidebarResize = useCallback((element?: HTMLDivElement, pointerId?: number) => {
    const resize = sidebarResizeRef.current
    if (pointerId !== undefined && element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    if (resize !== undefined && !resize.compact) writePersistentSidebarWidth(resize.lastWidth)
    sidebarResizeRef.current = undefined
    setSidebarResizing(false)
  }, [])
  const resizeSidebarFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | undefined
    if (event.key === 'Home') nextWidth = ARKME_PERSISTENT_SIDEBAR_MIN_WIDTH
    else if (event.key === 'End') nextWidth = ARKME_PERSISTENT_SIDEBAR_MAX_WIDTH
    else if (event.key === 'ArrowLeft') nextWidth = renderedSidebarWidth - 16
    else if (event.key === 'ArrowRight') nextWidth = renderedSidebarWidth + 16
    if (nextWidth === undefined) return
    event.preventDefault()
    const clamped = clampPersistentSidebarWidth(nextWidth)
    if (collapsed) setCompactSidebarWidthOverride(clamped)
    else {
      setPreferredSidebarWidth(clamped)
      writePersistentSidebarWidth(clamped)
    }
  }, [collapsed, renderedSidebarWidth])
  const sidebarSizingStyle = <style data-arkme-owned="persistent-sidebar-resize-handle-style">{`
    :root { --arkme-persistent-sidebar-width: ${String(renderedSidebarWidth)}px; }
    :root:has([data-arkme-owned="persistent-sidebar"]) [data-side="sidebar"] {
      left: ${String(renderedSidebarWidth)}px !important;
      pointer-events: none;
    }
    :root:has([data-arkme-owned="persistent-sidebar"][data-arkme-sidebar-resizing="true"]) [data-slot="root"] > div,
    :root:has([data-arkme-owned="persistent-sidebar"][data-arkme-sidebar-resizing="true"]) [data-side="sidebar"] {
      transition: none !important;
    }
    [data-arkme-owned="persistent-sidebar-resize-handle"]::after {
      content: "";
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 1px;
      background: var(--dsw-alias-border-l1, #e5e7eb);
      transition: width 80ms ease, background-color 80ms ease;
    }
    [data-arkme-owned="persistent-sidebar-resize-handle"]:hover::after,
    [data-arkme-owned="persistent-sidebar-resize-handle"]:focus-visible::after,
    [data-arkme-owned="persistent-sidebar"][data-arkme-sidebar-resizing="true"] [data-arkme-owned="persistent-sidebar-resize-handle"]::after {
      width: 3px;
      background: #09b83e;
    }
  `}</style>
  const sidebarResizeHandle = <div
    data-arkme-owned="persistent-sidebar-resize-handle"
    role="separator"
    aria-label={tr("调整对话列表宽度")}
    aria-orientation="vertical"
    aria-valuemin={ARKME_PERSISTENT_DIRECTORY_MIN_WIDTH}
    aria-valuemax={ARKME_PERSISTENT_DIRECTORY_MAX_WIDTH}
    aria-valuenow={renderedDirectoryWidth}
    tabIndex={0}
    style={styles.sidebarResizeHandle}
    onPointerDown={beginSidebarResize}
    onPointerMove={continueSidebarResize}
    onPointerUp={event => { stopSidebarResize(event.currentTarget, event.pointerId) }}
    onPointerCancel={event => { stopSidebarResize(event.currentTarget, event.pointerId) }}
    onLostPointerCapture={() => { stopSidebarResize() }}
    onKeyDown={resizeSidebarFromKeyboard}
  />

  if (loginMode) return webLockedMode ? <aside
    data-arkme-owned="persistent-sidebar"
    data-arkme-workspace
    data-arkme-login-mode="true"
    data-arkme-web-locked
    data-arkme-directory-visible="true"
    data-arkme-sidebar-collapsed={collapsed ? 'true' : 'false'}
    data-arkme-sidebar-resizing={sidebarResizing ? 'true' : 'false'}
    data-arkme-sidebar-width={renderedSidebarWidth}
    data-arkme-directory-width={renderedDirectoryWidth}
    style={styles.sidebar}
    aria-label={tr("Arkme 受限工作区导航")}
  >
    {sidebarSizingStyle}
    <ArkmeProductNavigation compact={false} hosted taskExpanded locked />
    <div style={styles.taskDirectory} data-arkme-directory-mode="web-locked">
      <ArkmeNavigation wide compactDirectory={compactDirectory} embeddedProductShell showHarnessEntry lockedDirectory />
    </div>
    {sidebarResizeHandle}
  </aside> : <aside
    data-arkme-owned="persistent-sidebar"
    data-arkme-login-mode="true"
    data-arkme-directory-visible="false"
    style={{ ...styles.sidebar, width: 0 }}
    aria-hidden
  />

  return <aside
    data-arkme-owned="persistent-sidebar"
    data-arkme-workspace
    data-arkme-sidebar-collapsed={collapsed ? 'true' : 'false'}
    data-arkme-harness-mode={harnessMode ? 'true' : 'false'}
    data-arkme-directory-visible={directoryVisible ? 'true' : 'false'}
    data-arkme-sidebar-resizing={sidebarResizing ? 'true' : 'false'}
    data-arkme-sidebar-width={renderedSidebarWidth}
    data-arkme-directory-width={renderedDirectoryWidth}
    data-arkme-login-mode="false"
    {...(contactsMode ? { 'data-arkme-contacts-mobile-view': scopedContacts.selection.kind !== 'none' ? 'content' : 'directory' } : {})}
    style={styles.sidebar}
    aria-label={tr("Arkme 功能导航栏")}
  >
    {directoryVisible && (!contactsMode || !collapsed) && sidebarSizingStyle}
    <ArkmeProductNavigation
      compact={false}
      hosted
      taskExpanded
      currentSessionId={sessionState.current}
    />
    <PersistentDirectoryPanel key={`${contactsAccountKey}:contacts`} active={directoryVisible && contactsMode} mode="contacts">
      <ContactDirectorySurface active={directoryVisible && contactsMode}
        accountKey={contactsAccountKey ?? ''} selection={scopedContacts.selection} refreshRevision={scopedContacts.refreshRevision}
        contactsAddedRevision={contactsAddedRevision}
        cacheFresh={contactsDirectoryCache?.fresh ?? false}
        expandedSections={scopedContacts.expandedSections}
        contactProfiles={scopedContacts.contactProfiles}
        toolbarActions={<ArkmeQuickAddButton
          notificationActivationRevision={ui.notificationActivationRevision ?? 0}
          onContactAdd={() => { setContactAddSession({ accountKey: contactsAccountKey }) }}
          onSourceCreated={source => {
            const context = contactsContextRef.current
            if (context.accountKey !== contactsAccountKey || !context.contactsMode) return
            arkmeContactsTab.invalidateDirectoryCache()
            arkmeChatDirectory.publish(arkmePrependSourceByIdentity(source, arkmeChatDirectory.getSnapshot().sources))
            arkmeUi.selectSource(source)
          }}
          onBotCreated={bot => {
            const context = contactsContextRef.current
            if (context.accountKey !== contactsAccountKey || !context.contactsMode) return
            arkmeContactsTab.invalidateDirectoryCache()
            arkmeUi.openBotConversation(bot)
          }}
        />}
        {...(contactsDirectoryCache === undefined ? {} : {
          initialState: contactsDirectoryCache.state,
        })}
        onStateChange={(state, refreshed, acknowledgedProfiles) => { arkmeContactsTab.cacheDirectoryState(state, refreshed, acknowledgedProfiles) }}
        onSelectionChange={selection => { arkmeContactsTab.activateAccount(contactsAccountKey); arkmeContactsTab.select(selection) }}
        onExpandedChange={(section, expanded) => { arkmeContactsTab.setSectionExpanded(section, expanded) }}
        onOpenGroup={() => undefined}
        onOpenBot={() => undefined}
      />
    </PersistentDirectoryPanel>
    <PersistentDirectoryPanel key={`${contactsAccountKey}:conversations`} active={directoryVisible && !contactsMode} mode="conversations">
      <ArkmeNavigation
        active={directoryVisible && !contactsMode}
        wide
        compactDirectory={compactDirectory}
        embeddedProductShell
        showHarnessEntry
        currentSessionId={sessionState.current}
        renderSlot={renderSlot}
        searchDshMessages={searchDsh}
        onOpenDshSession={sessionId => { openDshSession(sessionId); arkmeUi.showHarness() }}
        {...(sendToSelfSource === undefined ? {} : { sendToSelfSource })}
      />
    </PersistentDirectoryPanel>
    {directoryVisible && contactsMode && contactAddSession !== undefined && contactAddSession.accountKey === contactsAccountKey && <ContactDirectoryAddDialog
      shareWebsite={authState.config?.shareWebsite ?? ARKME_DEFAULT_SHARE_WEBSITE}
      onClose={() => { setContactAddSession(undefined) }}
      onAdded={source => {
        const auth = arkmeAuthStore.getSnapshot().auth
        const currentAccountKey = auth?.status === 'authenticated' ? `${auth.environment}:${String(auth.userId)}` : undefined
        if (currentAccountKey !== contactAddSession.accountKey) return
        arkmeContactsTab.invalidateDirectoryCache()
        arkmeChatDirectory.publish(arkmePrependSourceByIdentity(source, arkmeChatDirectory.getSnapshot().sources))
        const context = contactsContextRef.current
        if (context.accountKey !== currentAccountKey) return
        // Retained hidden directories consume this refresh when they become active again.
        setContactsAddedRevision(value => value + 1)
        if (!context.contactsMode) return
        // A late result from a closed dialog must not dismiss a newer dialog.
        setContactAddSession(current => current === contactAddSession ? undefined : current)
      }}
    />}
    {directoryVisible && (contactsMode
      ? <div aria-hidden style={{ flex: '0 0 3px', width: 3 }} />
      : sidebarResizeHandle)}
  </aside>
}

export type ArkmePersistentWorkspaceProps = PropsRuntime<'conversation'>
  & PropsLocale<typeof ARKME_LOGIN_LOCALE_NAMESPACE>
  & { closeDetails(): void }

/** Arkme keeps the conversation seat and embeds the complete native DSH client inside it. */
export function ArkmePersistentWorkspace({
  sessionId, closeDetails, t,
}: ArkmePersistentWorkspaceProps) {
  useArkmeLocale()
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const contacts = useSyncExternalStore(arkmeContactsTab.subscribe, arkmeContactsTab.getSnapshot, arkmeContactsTab.getSnapshot)
  const authenticatedUserId = authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined
  const contactsAccountKey = authState.auth?.status === 'authenticated' ? `${authState.auth.environment}:${String(authState.auth.userId)}` : undefined
  const scopedContacts = arkmeContactsTab.getSnapshotForAccount(contactsAccountKey)
  const contactsMode = ui.mode === 'source' && ui.productMode === 'contacts'
  const webLockedHarness = !startupAuthGateEnabled() && authState.auth?.status !== 'authenticated'
  const harnessVisible = ui.mode === 'harness' || webLockedHarness
  const conversationHidden = harnessVisible || contactsMode
  const conversationActive = !conversationHidden && ui.calendarOpen !== true
  const contactsContextRef = useRef({ accountKey: contactsAccountKey, contactsMode })
  contactsContextRef.current = { accountKey: contactsAccountKey, contactsMode }
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  useLayoutEffect(() => {
    arkmeContactsTab.activateAccount(contactsAccountKey)
  }, [contactsAccountKey])
  return <main
    data-arkme-owned="persistent-workspace"
    data-arkme-workspace
    data-arkme-notification-activation-revision={ui.notificationActivationRevision ?? 0}
    {...(contactsMode ? { 'data-arkme-contacts-mobile-view': scopedContacts.selection.kind !== 'none' ? 'content' : 'directory' } : {})}
    style={styles.workspace}
    aria-label={tr("Arkme 主界面")}
  >
    <ArkmePersistentClientRuntime />
    <ArkmeExtensionRecoveryNotice />
    <DeepSeekHarnessSurface
      key={contactsAccountKey ?? 'guest'}
      visible={harnessVisible}
      nativeSettings={webLockedHarness}
      accountId={authenticatedUserId}
      accountScope={contactsAccountKey}
      followSession={ui.mode === 'harness'}
    />
    {!webLockedHarness && <div
        data-arkme-owned="arkme-conversation-layer"
        style={{
          ...styles.conversationLayer,
          visibility: conversationHidden ? 'hidden' : 'visible',
          pointerEvents: conversationHidden ? 'none' : 'auto',
          zIndex: conversationHidden ? 0 : 1,
        }}
        aria-hidden={conversationHidden ? true : undefined}
      >
        <ArkmeSurface
          t={t}
          productChrome={false}
          productNavigation={false}
          ownsQrLogin={!startupAuthGateEnabled()}
          currentSessionId={sessionId}
          onActivateSurface={() => undefined}
          active={conversationActive}
        />
      </div>}
    {contactsMode && <div className="arkme-directory-detail-pane" data-arkme-contacts-workspace style={styles.contactsLayer}>
      {scopedContacts.selection.kind !== 'none' && <button type="button" className="arkme-directory-mobile-back" onClick={() => { arkmeContactsTab.clear() }}>{tr("返回联系人目录")}</button>}
      <DirectoryDetailPane
        onBotActivated={bot => {
          const current = arkmeContactsTab.getSnapshot()
          const context = contactsContextRef.current
          const currentUi = arkmeUi.getSnapshot()
          if (current.accountKey !== contactsAccountKey || context.accountKey !== contactsAccountKey || !context.contactsMode
            || currentUi.mode !== 'source' || currentUi.productMode !== 'contacts'
            || current.selection.kind !== 'bot' || current.selection.bot.botRef !== bot.botRef) return
          arkmeContactsTab.clear()
          arkmeUi.openBotConversation(bot)
        }}
        accountKey={contactsAccountKey ?? ''} selection={scopedContacts.selection}
        onProfileUpdated={profile => { if (contactsAccountKey !== undefined) arkmeContactsTab.updateContactProfile(contactsAccountKey, profile) }}
        onSelectionChange={selection => { arkmeContactsTab.activateAccount(contactsAccountKey); arkmeContactsTab.select(selection) }}
        onSourceActivated={source => {
          const current = arkmeContactsTab.getSnapshot()
          const currentUi = arkmeUi.getSnapshot()
          const context = contactsContextRef.current
          if (current.accountKey !== contactsAccountKey || context.accountKey !== contactsAccountKey || !context.contactsMode
            || currentUi.mode !== 'source' || currentUi.productMode !== 'contacts') return
          arkmeContactsTab.clear(); arkmeUi.selectSource(source)
        }}
        renderUnmarkedSpeakerDetail={candidateRef => <UnmarkedSpeakerDetail
          accountKey={contactsAccountKey ?? ''} candidateRef={candidateRef}
          onCandidateCleared={() => { arkmeContactsTab.clear() }} onDirectoryRefresh={() => { arkmeContactsTab.activateAccount(contactsAccountKey); arkmeContactsTab.refresh() }}
        />}
      />
    </div>}
  </main>
}

export type ArkmePersistentDetailsProps = PropsRuntime<'details'> & { closeDetails(): void }

/** Claim the details seat as an empty Arkme surface so the official DSH panel is never visible. */
export function ArkmePersistentDetails({ closeDetails }: ArkmePersistentDetailsProps) {
  useArkmeLocale()
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  return <aside data-arkme-owned="persistent-details" style={styles.details} aria-hidden />
}
