import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { DirectoryListing, SessionId, SessionSummary, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './slots-contract.js'
import type { ArkmeChatClientEvent } from '../types.js'
import { ArkmeOutgoingCallHost } from './ArkmeOutgoingCallHost.js'
import { ArkmeProductNavigation } from './ArkmeProductNavigation.js'
import { ArkmeSettingsSurface } from './ArkmeSettingsSurface.js'
import { ArkmeSurface } from './ArkmeSidebar.js'
import { ArkmeNavigation } from './ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation,
} from './chat-directory-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { arkmeUi } from './ui-controller.js'
import { ArkmeTaskDirectory, ArkmeTaskStart } from './redesign/ArkmeTaskSurface.js'
import { ArkmeWorkspaceDialog } from './redesign/ArkmeWorkspaceDialog.js'
import { needsArkmeWorkspaceBrowser } from './redesign/task-session.js'

const styles: Record<string, CSSProperties> = {
  sidebar: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    display: 'flex', overflow: 'hidden', background: '#fff',
  },
  taskDirectory: { minWidth: 0, flex: 1, overflow: 'hidden', borderLeft: '1px solid #ececef', background: '#fff' },
  workspace: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff',
  },
  details: { width: 0, height: 0, overflow: 'hidden' },
}

/** Permanent browser-side lifecycles that used to be owned by the optional DSH footer entry. */
export function ArkmePersistentClientRuntime() {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const auth = authState.auth

  useEffect(() => {
    void arkmeAuthStore.refresh().catch(() => undefined)
  }, [ui.authRevision])

  useEffect(() => {
    if (auth?.status !== 'authenticated') {
      arkmeChatDirectory.activateAccount(undefined)
      return
    }
    arkmeChatDirectory.activateAccount(auth.userId)
    let stopped = false
    let observedRevision: number | undefined
    const refreshUnread = async (force = false) => {
      await arkmeChatDirectory.refreshRoot({ force })
    }
    const events = new EventSource('/arkme-self/api/events')
    events.onmessage = event => {
      if (stopped) return
      try {
        const update = JSON.parse(event.data) as ArkmeChatClientEvent
        if (!Number.isSafeInteger(update.revision) || update.revision < 0
          || (observedRevision !== undefined && update.revision <= observedRevision)) return
        observedRevision = update.revision
        if (update.type === 'reconcile') {
          arkmeInterwovenInvalidation.invalidate()
          if (update.refresh === 'none') return
          void refreshUnread(update.refresh === 'force')
            .then(() => { if (!stopped) arkmeUi.chatChanged() })
            .catch(() => undefined)
          return
        }
        if (update.type === 'read-ack') {
          arkmeChatDirectory.updateReadAck(
            update.sourceRef,
            update.sourceKey,
            update.effectiveReadSequence,
            update.unreadCount,
          )
          return
        }
        if (update.type === 'message-notification') {
          void arkmeDesktopNotifications.show(update.notification)
          return
        }
        arkmeChatDirectory.upsertMany(update.updates.map(item => ({
          source: item.source,
          ...(item.sourceKey === undefined ? {} : { sourceKey: item.sourceKey }),
        })))
        const timelineUpdates = update.updates
          .filter(item => item.timelineItems.length > 0)
          .map(item => ({ sourceRef: item.source.sourceRef, items: item.timelineItems }))
        if (timelineUpdates.length > 0) arkmeChatTimelineDelta.publish(timelineUpdates)
        arkmeInterwovenInvalidation.invalidate()
      } catch { /* A malformed local frame must not unmount the persistent shell. */ }
    }
    return () => {
      stopped = true
      events.close()
    }
  }, [auth?.status, auth?.userId])

  return <ArkmeOutgoingCallHost />
}

export type ArkmePersistentSidebarProps = PropsRuntime<'sidebar'> & {
  collapseSidebar(): void
  closeDetails(): void
  openSession(sessionId: SessionId): void
}

/** Arkme permanently owns the DSH sidebar seat so navigation stays stable across Arkme and task conversations. */
export function ArkmePersistentSidebar({
  collapsed, useSessions, collapseSidebar, closeDetails, openSession,
}: ArkmePersistentSidebarProps) {
  const sessionState = useSessions(state => state)
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const taskMode = ui.mode === 'task-start' || ui.mode === 'task-session'
  const loginMode = ui.mode === 'login'
    || (authState.auth !== undefined && authState.auth.status !== 'authenticated')
  const directoryVisible = !loginMode && ui.calendarOpen !== true
    && (ui.mode === 'source' || ui.mode === 'arko' || taskMode)
  const taskSessions = useMemo(() => sessionState.ids
    .map(id => sessionState.byId[id])
    .filter((session): session is SessionSummary => session !== undefined
      && session.blank === false && session.origin !== 'subagent'), [sessionState.byId, sessionState.ids])
  useLayoutEffect(() => {
    closeDetails()
    if (collapsed) collapseSidebar()
  }, [closeDetails, collapseSidebar, collapsed])

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
    data-arkme-task-mode={taskMode ? 'true' : 'false'}
    data-arkme-directory-visible={directoryVisible ? 'true' : 'false'}
    data-arkme-login-mode="false"
    style={styles.sidebar}
    aria-label="Arkme 功能导航栏"
  >
    <ArkmeProductNavigation
      compact={false}
      hosted
      taskExpanded
      currentSessionId={sessionState.current}
    />
    {directoryVisible && <div style={styles.taskDirectory}>
      <ArkmeNavigation
        wide
        embeddedProductShell
        currentSessionId={sessionState.current}
        directoryLead={<ArkmeTaskDirectory
          sessions={taskSessions}
          selected={ui.mode === 'task-session' ? sessionState.current : undefined}
          onNew={() => { arkmeUi.showNewTask() }}
          onOpen={sessionId => { openSession(sessionId); arkmeUi.showTaskSession() }}
        />}
        onCreateTask={() => { arkmeUi.showNewTask() }}
      />
    </div>}
  </aside>
}

export type ArkmePersistentWorkspaceProps = PropsRuntime<'conversation'>
  & PropsRenderSlots<'arkme.directory.entry'>
  & {
    closeDetails(): void
    startSession(options?: { workspaceId?: WorkspaceId; path?: string }): Promise<SessionId | undefined>
    pickDirectory(): Promise<string | null>
    listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
    openSession(sessionId: SessionId): void
    sendPrompt(sessionId: SessionId, text: string): Promise<void>
  }

/** Arkme permanently owns the whole DSH conversation seat. */
export function ArkmePersistentWorkspace({
  sessionId, useSessions, renderSlot, closeDetails,
  startSession, pickDirectory, listDirectory, openSession, sendPrompt,
}: ArkmePersistentWorkspaceProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const sessionState = useSessions(state => state)
  const taskSessions = useMemo(() => sessionState.ids
    .map(id => sessionState.byId[id])
    .filter((session): session is SessionSummary => session !== undefined
      && session.blank === false && session.origin !== 'subagent'), [sessionState.byId, sessionState.ids])
  const [sending, setSending] = useState(false)
  const [preparingSession, setPreparingSession] = useState(false)
  const [promptError, setPromptError] = useState('')
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)
  const [pendingTaskPrompt, setPendingTaskPrompt] = useState<string>()
  useLayoutEffect(() => { closeDetails() }, [closeDetails])

  const prepareTaskSession = async (options?: { workspaceId?: WorkspaceId; path?: string }) => {
    setPreparingSession(true)
    setPromptError('')
    try {
      return await startSession(options)
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : '工作区准备失败，请稍后重试')
      return undefined
    } finally {
      setPreparingSession(false)
    }
  }

  const runPrompt = async (targetSessionId: SessionId, text: string) => {
    setSending(true)
    setPromptError('')
    try {
      await sendPrompt(targetSessionId, text)
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : '任务发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  const enterTask = (targetSessionId: SessionId, prompt?: string) => {
    openSession(targetSessionId)
    arkmeUi.showTaskSession()
    if (prompt !== undefined) void runPrompt(targetSessionId, prompt)
  }

  const requestTaskSession = (prompt?: string) => {
    void prepareTaskSession().then(async targetSessionId => {
      if (targetSessionId !== undefined) { enterTask(targetSessionId, prompt); return }
      setPendingTaskPrompt(prompt)
      try {
        const path = await pickDirectory()
        if (path === null) { setPendingTaskPrompt(undefined); return }
        const createdSessionId = await prepareTaskSession({ path })
        if (createdSessionId !== undefined) enterTask(createdSessionId, prompt)
        setPendingTaskPrompt(undefined)
      } catch (error) {
        if (needsArkmeWorkspaceBrowser(error)) setWorkspaceDialogOpen(true)
        else {
          setPendingTaskPrompt(undefined)
          setPromptError(error instanceof Error && error.message !== '' ? error.message : '工作区选择失败，请稍后重试')
        }
      }
    })
  }

  const taskDirectory = <ArkmeTaskDirectory
    sessions={taskSessions}
    selected={undefined}
    onNew={() => { arkmeUi.showNewTask() }}
    onOpen={targetSessionId => { enterTask(targetSessionId) }}
  />

  return <main data-arkme-owned="persistent-workspace" data-arkme-workspace style={styles.workspace} aria-label="Arkme 主界面">
    <ArkmePersistentClientRuntime />
    {ui.mode === 'task-start'
      ? <ArkmeTaskStart
        busy={sending || preparingSession}
        error={promptError}
        onChooseWorkspace={() => { setPendingTaskPrompt(undefined); setWorkspaceDialogOpen(true) }}
        onBrowsePlugins={() => { arkmeUi.showExtensions() }}
        onRun={requestTaskSession}
      />
      : ui.mode === 'settings'
        ? <div className="arkme-redesign-route-surface arkme-redesign-settings-page">
          <ArkmeSettingsSurface />
        </div>
        : <ArkmeSurface
          productChrome={false}
          productNavigation={false}
          currentSessionId={sessionId}
          renderSlot={renderSlot}
          directoryLead={taskDirectory}
          onCreateTask={() => { arkmeUi.showNewTask() }}
          onActivateSurface={() => undefined}
        />}
    <ArkmeWorkspaceDialog
      open={workspaceDialogOpen}
      busy={preparingSession}
      listDirectory={listDirectory}
      onCancel={() => { setWorkspaceDialogOpen(false); setPendingTaskPrompt(undefined) }}
      onSelect={path => {
        void prepareTaskSession({ path }).then(targetSessionId => {
          if (targetSessionId === undefined) return
          setWorkspaceDialogOpen(false)
          const prompt = pendingTaskPrompt
          setPendingTaskPrompt(undefined)
          enterTask(targetSessionId, prompt)
        })
      }}
    />
  </main>
}

export type ArkmePersistentDetailsProps = PropsRuntime<'details'> & { closeDetails(): void }

/** Claim the details seat as an empty Arkme surface so the official DSH panel is never visible. */
export function ArkmePersistentDetails({ closeDetails }: ArkmePersistentDetailsProps) {
  useLayoutEffect(() => { closeDetails() }, [closeDetails])
  return <aside data-arkme-owned="persistent-details" style={styles.details} aria-hidden />
}
