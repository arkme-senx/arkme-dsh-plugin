import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './slots-contract.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
import { ArkmeSurface } from './ArkmeSidebar.js'
import { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
import type { ArkmeDshMessageSearchResult } from './ArkmeSearchSurface.js'
import { ContactDirectorySurface } from './redesign/contacts/ContactDirectorySurface.js'
import { DirectoryDetailPane } from './redesign/contacts/DirectoryDetailPane.js'
import { UnmarkedSpeakerDetail } from './redesign/contacts/UnmarkedSpeakerDetail.js'
import { arkmeContactsTab } from './redesign/contacts/contacts-tab-store.js'
import { callArkme } from './api.js'
import { DeepSeekHarnessSurface } from './DeepSeekHarnessSurface.js'
import { startupAuthGateEnabled } from './ArkmeStartupAuthGate.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { useArkmeRealtimeClientEvents } from './realtime-client-events.js'
import { arkmeUi } from './ui-controller.js'
import { ARKME_LOGIN_LOCALE_NAMESPACE } from './arkme-login-locales.js'

const styles: Record<string, CSSProperties> = {
  sidebar: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    display: 'flex', overflow: 'hidden', background: '#fff',
  },
  taskDirectory: { minWidth: 0, flex: 1, overflow: 'hidden', borderLeft: '1px solid #ececef', background: '#fff' },
  workspace: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff', position: 'relative',
  },
  conversationLayer: {
    position: 'absolute', inset: 0, minWidth: 0, minHeight: 0,
  },
  details: { width: 0, height: 0, overflow: 'hidden' },
}

/** Permanent browser-side lifecycles that used to be owned by the optional DSH footer entry. */
export function ArkmePersistentClientRuntime() {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const auth = authState.auth

  useArkmeRealtimeClientEvents(auth, ui.authRevision, true)

  return <ArkmeOutgoingCallHost />
}

export type ArkmePersistentSidebarProps = PropsRuntime<'sidebar'>
  & PropsRenderSlots<'arkme.directory.entry'>
  & {
    collapseSidebar(): void
    closeDetails(): void
    searchDshMessages?(query: string, signal: AbortSignal): Promise<{ items: SessionSearchResultItem[]; hasMore: boolean }>
    openDshSession?(sessionId: string): void
  }

/** Arkme permanently owns the DSH sidebar seat so navigation stays stable across Arkme and Harness conversations. */
export function ArkmePersistentSidebar({
  collapsed, useSessions, renderSlot, collapseSidebar, closeDetails,
  searchDshMessages = async () => ({ items: [], hasMore: false }), openDshSession = () => undefined,
}: ArkmePersistentSidebarProps) {
  const sessionState = useSessions(state => state)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const harnessMode = ui.mode === 'harness'
  const loginMode = ui.mode === 'login'
    || (authState.auth !== undefined && authState.auth.status !== 'authenticated')
  const authenticatedUserId = authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined
  const contactsAccountKey = authState.auth?.status === 'authenticated' ? `${authState.auth.environment}:${String(authState.auth.userId)}` : undefined
  const contacts = useSyncExternalStore(arkmeContactsTab.subscribe, arkmeContactsTab.getSnapshot, arkmeContactsTab.getSnapshot)
  const scopedContacts = arkmeContactsTab.getSnapshotForAccount(contactsAccountKey)
  const contactsDirectoryCache = arkmeContactsTab.getDirectoryCache(contactsAccountKey)
  const contactsMode = ui.mode === 'source' && ui.productMode === 'contacts'
  const handoffControllerRef = useRef<AbortController>()
  const contactsContextRef = useRef({ accountKey: contactsAccountKey, contactsMode })
  contactsContextRef.current = { accountKey: contactsAccountKey, contactsMode }
  const [sendToSelfState, setSendToSelfState] = useState<{
    userId: number
    source: ArkmeSourceItem
  }>()
  const directoryVisible = !loginMode && ui.calendarOpen !== true
    && (ui.mode === 'source' || ui.mode === 'arko' || harnessMode)
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
  }, [authenticatedUserId, ui.recordRevision])
  const sendToSelfSource = sendToSelfState !== undefined && sendToSelfState.userId === authenticatedUserId
    ? sendToSelfState.source
    : undefined
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
    if (collapsed) collapseSidebar()
  }, [closeDetails, collapseSidebar, collapsed])
  useLayoutEffect(() => { arkmeContactsTab.activateAccount(contactsAccountKey) }, [contactsAccountKey])
  useEffect(() => arkmeContactsTab.bindAborter(() => { handoffControllerRef.current?.abort() }), [])
  useEffect(() => {
    if (!contactsMode) handoffControllerRef.current?.abort()
  }, [contactsMode, contactsAccountKey, contacts.generation])
  useEffect(() => () => { handoffControllerRef.current?.abort() }, [])

  if (loginMode) return <aside
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
    data-arkme-login-mode="false"
    {...(contactsMode ? { 'data-arkme-contacts-mobile-view': scopedContacts.selection.kind !== 'none' ? 'content' : 'directory' } : {})}
    style={styles.sidebar}
    aria-label="Arkme 功能导航栏"
  >
    <ArkmeProductNavigation
      compact={false}
      hosted
      taskExpanded
      currentSessionId={sessionState.current}
    />
    {directoryVisible && <div style={styles.taskDirectory} data-arkme-directory-mode={contactsMode ? 'contacts' : 'conversations'}>
      {contactsMode ? <ContactDirectorySurface
        accountKey={contactsAccountKey ?? ''} selection={scopedContacts.selection} refreshRevision={scopedContacts.refreshRevision}
        expandedSections={scopedContacts.expandedSections}
        {...(contactsDirectoryCache === undefined ? {} : {
          initialState: contactsDirectoryCache.state,
          cacheFresh: contactsDirectoryCache.fresh,
        })}
        onStateChange={(state, refreshed) => { arkmeContactsTab.cacheDirectoryState(state, refreshed) }}
        onSelectionChange={selection => { arkmeContactsTab.activateAccount(contactsAccountKey); arkmeContactsTab.select(selection) }}
        onExpandedChange={(section, expanded) => { arkmeContactsTab.setSectionExpanded(section, expanded) }}
        onOpenGroup={sourceRef => {
          arkmeContactsTab.activateAccount(contactsAccountKey)
          handoffControllerRef.current?.abort()
          const controller = new AbortController()
          handoffControllerRef.current = controller
          const generation = arkmeContactsTab.getSnapshot().generation
          const accountKey = contactsAccountKey
          void callArkme<ArkmeSourceItem>('directory.group.open-chat', { sourceRef }, controller.signal)
            .then(source => {
              const current = arkmeContactsTab.getSnapshot()
              const currentUi = arkmeUi.getSnapshot()
              const context = contactsContextRef.current
              if (controller.signal.aborted || current.generation !== generation || current.accountKey !== accountKey
                || context.accountKey !== accountKey || !context.contactsMode
                || currentUi.mode !== 'source' || currentUi.productMode !== 'contacts') return
              arkmeContactsTab.clear(); arkmeUi.selectSource(source)
            })
            .catch(() => undefined)
        }}
        onOpenBot={botRef => {
          arkmeContactsTab.activateAccount(contactsAccountKey)
          handoffControllerRef.current?.abort()
          const controller = new AbortController()
          handoffControllerRef.current = controller
          const generation = arkmeContactsTab.getSnapshot().generation
          const accountKey = contactsAccountKey
          void callArkme<ArkmeSourceItem>('directory.bot.open-chat', { botRef }, controller.signal)
            .then(source => {
              const current = arkmeContactsTab.getSnapshot()
              const currentUi = arkmeUi.getSnapshot()
              const context = contactsContextRef.current
              if (controller.signal.aborted || current.generation !== generation || current.accountKey !== accountKey
                || context.accountKey !== accountKey || !context.contactsMode
                || currentUi.mode !== 'source' || currentUi.productMode !== 'contacts') return
              arkmeContactsTab.clear(); arkmeUi.selectSource(source)
            })
            .catch(() => undefined)
        }}
      /> : <ArkmeNavigation
        wide
        embeddedProductShell
        showHarnessEntry
        currentSessionId={sessionState.current}
        renderSlot={renderSlot}
        searchDshMessages={searchDsh}
        onOpenDshSession={sessionId => { openDshSession(sessionId); arkmeUi.showHarness() }}
        {...(sendToSelfSource === undefined ? {} : { sendToSelfSource })}
      />}
    </div>}
  </aside>
}

export type ArkmePersistentWorkspaceProps = PropsRuntime<'conversation'>
  & PropsLocale<typeof ARKME_LOGIN_LOCALE_NAMESPACE>
  & { closeDetails(): void }

/** Arkme keeps the conversation seat and embeds the complete native DSH client inside it. */
export function ArkmePersistentWorkspace({
  sessionId, closeDetails, t,
}: ArkmePersistentWorkspaceProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const contacts = useSyncExternalStore(arkmeContactsTab.subscribe, arkmeContactsTab.getSnapshot, arkmeContactsTab.getSnapshot)
  const authenticatedUserId = authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined
  const contactsAccountKey = authState.auth?.status === 'authenticated' ? `${authState.auth.environment}:${String(authState.auth.userId)}` : undefined
  const scopedContacts = arkmeContactsTab.getSnapshotForAccount(contactsAccountKey)
  const contactsMode = ui.mode === 'source' && ui.productMode === 'contacts'
  const contactsContextRef = useRef({ accountKey: contactsAccountKey, contactsMode })
  contactsContextRef.current = { accountKey: contactsAccountKey, contactsMode }
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  useLayoutEffect(() => {
    arkmeContactsTab.activateAccount(contactsAccountKey)
    if (!contactsMode) arkmeContactsTab.clear()
  }, [contactsAccountKey, contactsMode])

  return <main data-arkme-owned="persistent-workspace" data-arkme-workspace {...(contactsMode ? { 'data-arkme-contacts-mobile-view': scopedContacts.selection.kind !== 'none' ? 'content' : 'directory' } : {})} style={styles.workspace} aria-label="Arkme 主界面">
    <ArkmePersistentClientRuntime />
    <DeepSeekHarnessSurface visible={ui.mode === 'harness'} />
    {contactsMode ? <div className="arkme-directory-detail-pane" data-arkme-contacts-workspace>
      {scopedContacts.selection.kind !== 'none' && <button type="button" className="arkme-directory-mobile-back" onClick={() => { arkmeContactsTab.clear() }}>返回联系人目录</button>}
      <DirectoryDetailPane
        accountKey={contactsAccountKey ?? ''} selection={scopedContacts.selection}
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
    </div> : <div
        data-arkme-owned="arkme-conversation-layer"
        style={{
          ...styles.conversationLayer,
          visibility: ui.mode === 'harness' ? 'hidden' : 'visible',
          pointerEvents: ui.mode === 'harness' ? 'none' : 'auto',
          zIndex: ui.mode === 'harness' ? 0 : 1,
        }}
        aria-hidden={ui.mode === 'harness' ? true : undefined}
      >
        <ArkmeSurface
          t={t}
          productChrome={false}
          productNavigation={false}
          ownsQrLogin={!startupAuthGateEnabled()}
          currentSessionId={sessionId}
          onActivateSurface={() => undefined}
        />
      </div>}
  </main>
}

export type ArkmePersistentDetailsProps = PropsRuntime<'details'> & { closeDetails(): void }

/** Claim the details seat as an empty Arkme surface so the official DSH panel is never visible. */
export function ArkmePersistentDetails({ closeDetails }: ArkmePersistentDetailsProps) {
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  return <aside data-arkme-owned="persistent-details" style={styles.details} aria-hidden />
}
