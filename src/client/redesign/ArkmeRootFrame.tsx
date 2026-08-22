import {
  useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type FormEvent,
} from 'react'
import { ArrowUp } from '@phosphor-icons/react/ArrowUp'
import { CaretDown } from '@phosphor-icons/react/CaretDown'
import { CaretLeft } from '@phosphor-icons/react/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/CaretRight'
import { CalendarBlank } from '@phosphor-icons/react/CalendarBlank'
import { ChatCircleText } from '@phosphor-icons/react/ChatCircleText'
import { FileText } from '@phosphor-icons/react/FileText'
import { Fingerprint } from '@phosphor-icons/react/Fingerprint'
import { GearSix } from '@phosphor-icons/react/GearSix'
import { GlobeHemisphereWest } from '@phosphor-icons/react/GlobeHemisphereWest'
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass'
import { Microphone } from '@phosphor-icons/react/Microphone'
import { Paperclip } from '@phosphor-icons/react/Paperclip'
import { Plus } from '@phosphor-icons/react/Plus'
import { SquaresFour } from '@phosphor-icons/react/SquaresFour'
import { Waveform } from '@phosphor-icons/react/Waveform'
import type { Icon } from '@phosphor-icons/react/lib'
import type { DirectoryListing, SessionId, SessionSummary, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../../types.js'
import { callArkme } from '../api.js'
import { ArkmeUserAvatar } from '../ArkmeAvatar.js'
import { ARKME_WORDMARK_DATA_URL } from '../arkme-wordmark.js'
import { ArkmeExtensionCenter } from '../ArkmeExtensionCenter.js'
import { ArkmeCalendarSurface } from '../ArkmeCalendarSurface.js'
import { ArkmeRecordingSurface } from '../ArkmeRecordingSurface.js'
import { ArkmeSearchSurface } from '../ArkmeSearchSurface.js'
import { ArkmeSettingsSurface } from '../ArkmeSettingsSurface.js'
import { ArkmeSurface } from '../ArkmeSidebar.js'
import { ArkmeNavigation } from '../ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from '../auth-store.js'
import { arkmeUi } from '../ui-controller.js'
import type { ArkmeLayoutController } from './layout-controller.js'
import { ArkmeWorkspaceDialog } from './ArkmeWorkspaceDialog.js'
import { needsArkmeWorkspaceBrowser } from './task-session.js'
import redesignCss from './arkme-redesign.css?inline'

const REDESIGN_STYLE_ID = '@senguoyun/dsh-arkme/redesign'

export function installArkmeRedesignStyles(): () => void {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${REDESIGN_STYLE_ID}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = '@senguoyun/dsh-arkme'
  style.dataset.pluginCss = REDESIGN_STYLE_ID
  style.textContent = redesignCss
  document.head.append(style)
  return () => { style.remove() }
}

export type ArkmeRoute = 'chats' | 'recordings' | 'search' | 'plugins' | 'settings'

export interface ArkmeRootInjected {
  layout: ArkmeLayoutController
  startSession(options?: { workspaceId?: WorkspaceId; path?: string }): Promise<SessionId | undefined>
  pickDirectory(): Promise<string | null>
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  openSession(sessionId: SessionId): void
  sendPrompt(sessionId: SessionId, text: string): Promise<void>
}

export type ArkmeRootFrameProps = PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay' | 'settings.section' | 'arkme.directory.entry'>
  & ArkmeRootInjected

interface NavItem {
  id: Exclude<ArkmeRoute, 'settings'> | 'calendar'
  label: string
  icon: Icon
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'chats', label: '对话', icon: ChatCircleText },
  { id: 'recordings', label: '录音', icon: Waveform },
  { id: 'search', label: '搜索', icon: MagnifyingGlass },
  { id: 'calendar', label: '日历', icon: CalendarBlank },
  { id: 'plugins', label: '插件', icon: SquaresFour },
]

function taskTime(updatedAt: number): string {
  const delta = Date.now() - updatedAt
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${String(Math.max(1, Math.floor(delta / 60_000)))} 分钟前`
  const date = new Date(updatedAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function TaskDirectorySection({
  sessions,
  selected,
  onNew,
  onOpen,
}: {
  sessions: readonly SessionSummary[]
  selected: SessionId | undefined
  onNew(): void
  onOpen(sessionId: SessionId): void
}) {
  return <section className="arkme-redesign-task-section" aria-label="与 Arkme 沟通任务" tabIndex={0}>
    <div className="arkme-redesign-task-section-title">
      <strong>与 Arkme 沟通任务</strong>
      <button type="button" aria-label="新任务" onClick={onNew}><Plus size={16} /></button>
    </div>
    {sessions.length === 0
      ? <button type="button" className="arkme-redesign-task-first" onClick={onNew}>+ 开始第一个任务</button>
      : <div className="arkme-redesign-task-list">{sessions.map(session => {
        const active = session.running || session.pendingInteraction !== undefined
        return <button
          type="button"
          key={session.id}
          className={selected === session.id ? 'is-selected' : ''}
          onClick={() => { onOpen(session.id) }}
        >
          <span className={`arkme-redesign-task-state${active ? ' is-running' : ' is-complete'}`} aria-hidden>
            {active
              ? <span className="arkme-redesign-task-matrix">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</span>
              : <i />}
          </span>
          <span className="arkme-redesign-task-copy">
            <strong>{session.displayTitle}</strong>
            <small>{taskTime(session.updatedAt)}</small>
          </span>
        </button>
      })}</div>}
  </section>
}

function TaskStart({ busy, error, onChooseWorkspace, onBrowsePlugins, onRun }: {
  busy: boolean
  error: string
  onChooseWorkspace(): void
  onBrowsePlugins(): void
  onRun(prompt: string): void
}) {
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = prompt.trim()
    if (value === '' || busy) return
    onRun(value)
  }
  const suggestions = [
    { title: '整理一段文字', detail: '粘贴内容即可', value: '帮我整理这段文字', Icon: FileText },
    { title: '处理一段录音', detail: '拖入录音即可', value: '帮我处理这段录音', Icon: Waveform },
    { title: '试试插件', detail: '发现更多能力', value: '', Icon: SquaresFour },
  ] as const
  return <section className="arkme-redesign-task-start">
    <div className="arkme-redesign-task-start-inner">
      <div className="arkme-redesign-task-greeting"><img src={ARKME_WORDMARK_DATA_URL} alt="Arkme" /><h1>想先从什么开始？</h1></div>
      <form className="arkme-redesign-hero-input" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={event => { setPrompt(event.target.value) }}
          placeholder="贴一段文字、拖入文件，或直接描述目标…"
          aria-label="告诉 Arkme 你的目标"
        />
        <div className="arkme-redesign-hero-controls">
          <button type="button" className="arkme-redesign-source-button" onClick={onChooseWorkspace}>我的内容 <CaretDown size={14} /></button>
          <div>
            <button type="button" className="arkme-redesign-round-tool" aria-label="添加附件"><Paperclip size={21} /></button>
            <button type="button" className="arkme-redesign-round-tool" aria-label="语音输入"><Microphone size={21} /></button>
            <button className="arkme-redesign-send-task" disabled={prompt.trim() === '' || busy} aria-label="开始任务">
              <ArrowUp size={22} weight="bold" />
            </button>
          </div>
        </div>
      </form>
      {error !== '' && <div className="arkme-redesign-task-error" role="alert">{error}</div>}
      <div className="arkme-redesign-starters" aria-label="可以试试">
        {suggestions.map(({ title, detail, value, Icon }) => <button type="button" key={title} onClick={() => {
          if (title === '试试插件') {
            onBrowsePlugins()
          } else {
            setPrompt(value)
            inputRef.current?.focus()
          }
        }}>
          <span className="arkme-redesign-starter-icon"><Icon size={20} /></span>
          <span><strong>{title}</strong><small>{detail}</small></span>
        </button>)}
      </div>
    </div>
  </section>
}

export function ArkmeRootFrame({
  useSessions,
  useWorkspaces,
  renderSlot,
  layout,
  startSession,
  pickDirectory,
  listDirectory,
  openSession,
  sendPrompt,
}: ArkmeRootFrameProps) {
  const [route, setRoute] = useState<ArkmeRoute>('chats')
  const [settingsView, setSettingsView] = useState<'overview' | 'models'>('overview')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [taskStartOpen, setTaskStartOpen] = useState(true)
  const [taskConversationOpen, setTaskConversationOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [preparingSession, setPreparingSession] = useState(false)
  const [promptError, setPromptError] = useState('')
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)
  const [pendingTaskPrompt, setPendingTaskPrompt] = useState<string>()
  const [profile, setProfile] = useState<ArkmeUserProfile>()
  const layoutState = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const arkmeUiState = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const sessionState = useSessions(state => state)
  const current = sessionState.current === undefined ? undefined : sessionState.byId[sessionState.current]
  const taskSessions = useMemo(() => sessionState.ids
    .map(id => sessionState.byId[id])
    .filter((session): session is SessionSummary => session !== undefined
      && session.blank === false && session.origin !== 'subagent'), [sessionState.byId, sessionState.ids])

  useEffect(() => {
    if (authState.auth?.status !== 'authenticated') {
      setProfile(undefined)
      return
    }
    let active = true
    const controller = new AbortController()
    void callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, controller.signal)
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, controller.signal)
        : snapshot)
      .then(snapshot => { if (active && snapshot.profile !== null) setProfile(snapshot.profile) })
      .catch(() => undefined)
    return () => { active = false; controller.abort() }
  }, [authState.auth?.status, authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined])

  const runPrompt = async (sessionId: SessionId, text: string) => {
    setSending(true)
    setPromptError('')
    try {
      await sendPrompt(sessionId, text)
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : '任务发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  const prepareTaskSession = async (options?: { workspaceId?: WorkspaceId; path?: string }): Promise<SessionId | undefined> => {
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

  const selectRoute = (next: ArkmeRoute) => {
    setRoute(next)
    setSettingsView('overview')
    setCalendarOpen(false)
    setProfileOpen(false)
    if (next === 'chats') arkmeUi.focusSendToSelf()
    if (next === 'recordings') arkmeUi.showRecordings()
    if (next === 'search') arkmeUi.showSearch()
    if (next === 'plugins') arkmeUi.showExtensions()
  }

  const requestTaskSession = (prompt?: string) => {
    void prepareTaskSession().then(async sessionId => {
      if (sessionId !== undefined) {
        setTaskStartOpen(false)
        setTaskConversationOpen(true)
        openSession(sessionId)
        if (prompt !== undefined) void runPrompt(sessionId, prompt)
        return
      }
      setPendingTaskPrompt(prompt)
      setPreparingSession(true)
      try {
        const path = await pickDirectory()
        if (path === null) {
          setPendingTaskPrompt(undefined)
          return
        }
        const createdSessionId = await prepareTaskSession({ path })
        if (createdSessionId !== undefined) {
          setTaskStartOpen(false)
          setTaskConversationOpen(true)
          openSession(createdSessionId)
          if (prompt !== undefined) void runPrompt(createdSessionId, prompt)
        }
        setPendingTaskPrompt(undefined)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (needsArkmeWorkspaceBrowser(error)) {
          setWorkspaceDialogOpen(true)
        } else {
          setPendingTaskPrompt(undefined)
          setPromptError(message === '' ? '工作区选择失败，请稍后重试' : message)
        }
      } finally {
        setPreparingSession(false)
      }
    })
  }
  const showNewTask = () => {
    setRoute('chats')
    setCalendarOpen(false)
    setProfileOpen(false)
    setTaskConversationOpen(false)
    setTaskStartOpen(true)
  }
  const openTask = (sessionId: SessionId) => {
    setRoute('chats')
    setCalendarOpen(false)
    setProfileOpen(false)
    setTaskStartOpen(false)
    setTaskConversationOpen(true)
    openSession(sessionId)
  }
  const openCalendar = () => {
    setCalendarOpen(value => !value)
    setProfileOpen(false)
    arkmeUi.showCalendar()
  }
  const hasSecondaryPanel = layoutState.sidebarOpen && route === 'chats'
  const authRequiresLogin = authState.checked && authState.auth?.status !== 'authenticated'
  const loginTakeover = authRequiresLogin || (arkmeUiState.mode === 'login' && arkmeUiState.surfaceOpen)
  return <div className="arkme-redesign-root" data-arkme-workspace data-route={route} data-login-takeover={loginTakeover ? '' : undefined}>
    {!loginTakeover && <aside className="arkme-redesign-rail" aria-label="主要功能">
      <div className="arkme-redesign-rail-primary">{NAV_ITEMS.map(item => {
        const IconComponent = item.icon
        return <button
          type="button"
          key={item.id}
          className={(item.id === 'calendar' ? calendarOpen : route === item.id) ? 'is-active' : ''}
          onClick={() => {
            if (item.id === 'calendar') openCalendar()
            else selectRoute(item.id)
          }}
          aria-label={item.label}
          title={item.label}
        >
          <IconComponent size={22} weight="regular" />
          <span>{item.label}</span>
        </button>
      })}</div>
      <div className="arkme-redesign-rail-footer">
        {profileOpen && <div className="arkme-redesign-profile-popover" role="menu" aria-label="个人菜单">
          <div className="arkme-redesign-profile-head">
            <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={40} label="当前用户头像" />
            <span><strong>{profile?.displayName || profile?.nickname || 'Arkme 用户'}</strong><small>{profile?.arkmeId ? `@${profile.arkmeId}` : 'Arkme 账号'}</small></span>
          </div>
          <div className="arkme-redesign-profile-menu">
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false) }}><GlobeHemisphereWest size={19} /><span><strong>我的世界</strong><small>管理你的个人内容</small></span><CaretRight size={15} /></button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false) }}><Fingerprint size={19} /><span><strong>声纹管理</strong><small>设置声音识别</small></span><CaretRight size={15} /></button>
            <button type="button" role="menuitem" onClick={() => { selectRoute('settings') }}><GearSix size={19} /><span><strong>设置</strong><small>账号与应用设置</small></span><CaretRight size={15} /></button>
          </div>
        </div>}
        <button type="button" className={`arkme-redesign-profile${profileOpen ? ' is-active' : ''}`} aria-label="个人资料" onClick={() => { setProfileOpen(value => !value); setCalendarOpen(false) }}>
          <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={32} label="当前用户头像" />
        </button>
      </div>
    </aside>}

    {!loginTakeover && route === 'chats' && layoutState.sidebarOpen && <aside className="arkme-redesign-chat-panel">
      <div className="arkme-redesign-chat-directory">
        <ArkmeNavigation
          wide
          embeddedProductShell
          currentSessionId={sessionState.current}
          directoryLead={<TaskDirectorySection
            sessions={taskSessions.slice(0, 3)}
            selected={taskConversationOpen && current?.blank !== true ? sessionState.current : undefined}
            onNew={showNewTask}
            onOpen={openTask}
          />}
          onCreateTask={showNewTask}
          onActivateSurface={() => { setTaskStartOpen(false); setTaskConversationOpen(false) }}
          renderSlot={renderSlot}
        />
      </div>
    </aside>}

    <main className={`arkme-redesign-content${loginTakeover ? ' is-login-takeover' : ''}${!loginTakeover && hasSecondaryPanel ? ' has-panel' : ''}${!loginTakeover && layoutState.detailsOpen ? ' has-details' : ''}`}>
      {loginTakeover
        ? <div className="arkme-redesign-route-surface arkme-redesign-route-chats"><ArkmeSurface productChrome={false} /></div>
        : route === 'chats'
        ? taskStartOpen
          ? <TaskStart
            busy={sending || preparingSession}
            error={promptError}
            onChooseWorkspace={() => { setPendingTaskPrompt(undefined); setWorkspaceDialogOpen(true) }}
            onBrowsePlugins={() => { selectRoute('plugins') }}
            onRun={text => {
              requestTaskSession(text)
            }} />
          : taskConversationOpen
            ? <div className="arkme-redesign-route-surface arkme-redesign-task-conversation">{renderSlot('conversation', {})}</div>
            : <div className="arkme-redesign-route-surface arkme-redesign-route-chats"><ArkmeSurface productChrome={false} /></div>
          : route === 'recordings'
            ? <div className="arkme-redesign-route-surface arkme-redesign-recordings-page"><ArkmeRecordingSurface /></div>
            : route === 'search'
              ? <section className="arkme-redesign-feature-page arkme-redesign-search-page">
                <header><p>搜索</p><h1>一句话，找到所有内容</h1><span>对话、录音和任务会一起搜索。</span></header>
                <div className="arkme-redesign-feature-body"><ArkmeSearchSurface /></div>
              </section>
              : route === 'plugins'
                ? <div className="arkme-redesign-route-surface arkme-redesign-plugins-page">
                  <ArkmeExtensionCenter
                    embedded
                    currentSessionId={sessionState.current}
                    {...(authState.auth?.status === 'authenticated' && authState.auth.userId !== undefined
                      ? { currentUserId: authState.auth.userId }
                      : {})}
                    onClose={() => undefined}
                  />
                </div>
                : <div className="arkme-redesign-route-surface arkme-redesign-settings-page">
                  {settingsView === 'models'
                    ? <section className="arkme-redesign-model-settings" aria-label="模型与 API Key">
                      <header>
                        <button type="button" onClick={() => { setSettingsView('overview') }}>
                          <CaretLeft size={17} weight="bold" />
                          <span>设置</span>
                        </button>
                      </header>
                      <div className="arkme-redesign-model-settings-body">
                        {renderSlot('settings.section', { close: () => { setSettingsView('overview') } }, { only: 'models' })}
                      </div>
                    </section>
                    : <ArkmeSettingsSurface onOpenModels={() => { setSettingsView('models') }} />}
                </div>}
    </main>

    {!loginTakeover && route === 'chats' && taskConversationOpen && layoutState.detailsOpen && <aside className="arkme-redesign-details">
      {renderSlot('details', {})}
    </aside>}
    {!loginTakeover && calendarOpen && <div className="arkme-redesign-calendar-overlay"><ArkmeCalendarSurface onClose={() => { setCalendarOpen(false) }} /></div>}
    <div className="arkme-redesign-overlays" data-shell-overlay>
      {renderSlot('shell.overlay', {})}
    </div>
    {!loginTakeover && <ArkmeWorkspaceDialog
      open={workspaceDialogOpen}
      busy={preparingSession}
      listDirectory={listDirectory}
      onCancel={() => { setWorkspaceDialogOpen(false); setPendingTaskPrompt(undefined) }}
      onSelect={path => {
        void prepareTaskSession({ path }).then(sessionId => {
          if (sessionId === undefined) return
          setWorkspaceDialogOpen(false)
          setTaskStartOpen(false)
          setTaskConversationOpen(true)
          openSession(sessionId)
          const prompt = pendingTaskPrompt
          setPendingTaskPrompt(undefined)
          if (prompt !== undefined) void runPrompt(sessionId, prompt)
        })
      }}
    />}
  </div>
}
