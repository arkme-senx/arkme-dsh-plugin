import {
  useMemo, useRef, useState, useSyncExternalStore,
  type FormEvent,
} from 'react'
import { ArrowUp } from '@phosphor-icons/react/ArrowUp'
import { CaretDown } from '@phosphor-icons/react/CaretDown'
import { CalendarBlank } from '@phosphor-icons/react/CalendarBlank'
import { ChatCircleText } from '@phosphor-icons/react/ChatCircleText'
import { CheckSquare } from '@phosphor-icons/react/CheckSquare'
import { GearSix } from '@phosphor-icons/react/GearSix'
import { ListChecks } from '@phosphor-icons/react/ListChecks'
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass'
import { Microphone } from '@phosphor-icons/react/Microphone'
import { Paperclip } from '@phosphor-icons/react/Paperclip'
import { PencilSimpleLine } from '@phosphor-icons/react/PencilSimpleLine'
import { Plus } from '@phosphor-icons/react/Plus'
import { Sparkle } from '@phosphor-icons/react/Sparkle'
import { SquaresFour } from '@phosphor-icons/react/SquaresFour'
import { WarningCircle } from '@phosphor-icons/react/WarningCircle'
import { Waveform } from '@phosphor-icons/react/Waveform'
import type { Icon } from '@phosphor-icons/react/lib'
import type { DirectoryListing, SessionId, SessionSummary, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ArkmeMark } from '../ArkmeFooterAction.js'
import { ArkmeExtensionCenter } from '../ArkmeExtensionCenter.js'
import { ArkmeCalendarSurface } from '../ArkmeCalendarSurface.js'
import { ArkmeRecordingSurface } from '../ArkmeRecordingSurface.js'
import { ArkmeSearchSurface } from '../ArkmeSearchSurface.js'
import { ArkmeSettingsRow } from '../ArkmeSettingsRow.js'
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

export type ArkmeRoute = 'chats' | 'tasks' | 'recordings' | 'search' | 'calendar' | 'plugins' | 'settings'

export interface ArkmeRootInjected {
  layout: ArkmeLayoutController
  startSession(options?: { workspaceId?: WorkspaceId; path?: string }): Promise<SessionId | undefined>
  pickDirectory(): Promise<string | null>
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  openSession(sessionId: SessionId): void
  sendPrompt(sessionId: SessionId, text: string): Promise<void>
}

export type ArkmeRootFrameProps = PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay' | 'arkme.directory.entry'>
  & ArkmeRootInjected

interface NavItem {
  id: Exclude<ArkmeRoute, 'settings'>
  label: string
  icon: Icon
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'chats', label: '对话', icon: ChatCircleText },
  { id: 'tasks', label: '任务', icon: ListChecks },
  { id: 'recordings', label: '录音', icon: Waveform },
  { id: 'search', label: '搜索', icon: MagnifyingGlass },
  { id: 'calendar', label: '日历', icon: CalendarBlank },
  { id: 'plugins', label: '插件', icon: SquaresFour },
]

function taskStatus(session: SessionSummary): string {
  if (session.pendingInteraction !== undefined) return '等待确认'
  if (session.running) return '进行中'
  if (session.completed === true) return '已完成'
  return '最近使用'
}

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

function TaskPanel({
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
  return <aside className="arkme-redesign-task-panel">
    <div className="arkme-redesign-panel-title">
      <h1>任务</h1>
      <button type="button" aria-label="新建任务" onClick={onNew}><Plus size={19} /></button>
    </div>
    <button
      type="button"
      className={`arkme-redesign-new-task${selected === undefined ? ' is-selected' : ''}`}
      onClick={onNew}
    >
      <PencilSimpleLine size={18} />
      <span>新任务</span>
    </button>
    <div className="arkme-redesign-section-label">最近</div>
    {sessions.length === 0
      ? <div className="arkme-redesign-task-empty">
        <span><Sparkle size={16} /></span>
        <strong>从第一个任务开始</strong>
        <p>完成后的任务会保存在这里。</p>
      </div>
      : <div className="arkme-redesign-task-list">{sessions.map(session => {
        const waiting = session.pendingInteraction !== undefined
        return <button
          type="button"
          key={session.id}
          className={selected === session.id ? 'is-selected' : ''}
          onClick={() => { onOpen(session.id) }}
        >
          <span className={`arkme-redesign-task-state${waiting ? ' is-waiting' : ''}`}>
            {waiting ? <WarningCircle size={17} /> : <CheckSquare size={17} />}
          </span>
          <span className="arkme-redesign-task-copy">
            <strong>{session.displayTitle}</strong>
            <small>{taskTime(session.updatedAt)} · {taskStatus(session)}</small>
          </span>
        </button>
      })}</div>}
  </aside>
}

function TaskStart({ busy, error, workspaceLabel, onChooseWorkspace, onRun }: {
  busy: boolean
  error: string
  workspaceLabel: string
  onChooseWorkspace(): void
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
    ['整理当前项目', '梳理代码现状并列出下一步', '分析当前项目，整理现状并给出下一步计划'],
    ['检查最近改动', '找出风险与遗漏', '检查当前项目最近的改动，找出风险和遗漏'],
    ['继续已有任务', '基于当前工作区推进', '阅读当前工作区上下文并继续完成尚未收口的任务'],
  ] as const
  return <section className="arkme-redesign-task-start">
    <div className="arkme-redesign-task-start-inner">
      <p className="arkme-redesign-kicker">上午好</p>
      <h1>今天想处理什么？</h1>
      <p>Arkme 会在当前 DeepSeek Harness 工作区中帮你完成。</p>
      <form className="arkme-redesign-hero-input" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={event => { setPrompt(event.target.value) }}
          placeholder="例如：检查当前项目，并整理下一步计划"
          aria-label="告诉 Arkme 你的目标"
        />
        <div className="arkme-redesign-hero-controls">
          <button type="button" className="arkme-redesign-source-button" onClick={onChooseWorkspace}>{workspaceLabel} <CaretDown size={14} /></button>
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
        {suggestions.map(([title, detail, value]) => <button type="button" key={title} onClick={() => {
          setPrompt(value)
          inputRef.current?.focus()
        }}>
          <span className="arkme-redesign-starter-icon"><Sparkle size={20} /></span>
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
  const [route, setRoute] = useState<ArkmeRoute>('tasks')
  const [sending, setSending] = useState(false)
  const [preparingSession, setPreparingSession] = useState(false)
  const [promptError, setPromptError] = useState('')
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)
  const [pendingTaskPrompt, setPendingTaskPrompt] = useState<string>()
  const layoutState = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const sessionState = useSessions(state => state)
  const workspaceState = useWorkspaces(state => state)
  const current = sessionState.current === undefined ? undefined : sessionState.byId[sessionState.current]
  const taskSessions = useMemo(() => sessionState.ids
    .map(id => sessionState.byId[id])
    .filter((session): session is SessionSummary => session !== undefined
      && session.blank === false && session.origin !== 'subagent'), [sessionState.byId, sessionState.ids])

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
    if (next === 'chats') arkmeUi.focusSendToSelf()
    if (next === 'recordings') arkmeUi.showRecordings()
    if (next === 'search') arkmeUi.showSearch()
    if (next === 'calendar') arkmeUi.showCalendar()
    if (next === 'plugins') arkmeUi.showExtensions()
  }

  const showTaskStart = current === undefined || current.blank
  const taskWorkspace = current === undefined
    ? workspaceState.items.find(workspace => workspace.workspaceId === workspaceState.recentWorkspaceId)
    : workspaceState.items.find(workspace => workspace.sessionIds.includes(current.id))
  const taskWorkspaceLabel = taskWorkspace?.title ?? (workspaceState.items.length === 0 ? '选择工作区' : '当前工作区')
  const requestTaskSession = (prompt?: string) => {
    void prepareTaskSession().then(async sessionId => {
      if (sessionId !== undefined) {
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
        if (createdSessionId !== undefined && prompt !== undefined) void runPrompt(createdSessionId, prompt)
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
  const hasSecondaryPanel = layoutState.sidebarOpen && (route === 'tasks' || route === 'chats')
  return <div className="arkme-redesign-root" data-arkme-workspace data-route={route}>
    <aside className="arkme-redesign-rail" aria-label="主要功能">
      <div className="arkme-redesign-rail-primary">{NAV_ITEMS.map(item => {
        const IconComponent = item.icon
        return <button
          type="button"
          key={item.id}
          className={route === item.id ? 'is-active' : ''}
          onClick={() => { selectRoute(item.id) }}
          aria-label={item.label}
          title={item.label}
        >
          <IconComponent size={22} weight="regular" />
          <span>{item.label}</span>
        </button>
      })}</div>
      <div className="arkme-redesign-rail-footer">
        <button type="button" className="arkme-redesign-profile" aria-label="个人资料"><ArkmeMark /></button>
        <button
          type="button"
          className={route === 'settings' ? 'is-active' : ''}
          onClick={() => { selectRoute('settings') }}
          aria-label="设置"
        ><GearSix size={21} /></button>
      </div>
    </aside>

    {route === 'tasks' && layoutState.sidebarOpen && <TaskPanel
      sessions={taskSessions}
      selected={current?.blank === true ? undefined : sessionState.current}
      onNew={() => { requestTaskSession() }}
      onOpen={openSession}
    />}

    {route === 'chats' && layoutState.sidebarOpen && <aside className="arkme-redesign-chat-panel">
      <div className="arkme-redesign-panel-title">
        <h1>对话</h1>
        <button type="button" aria-label="新建对话" onClick={() => { arkmeUi.focusSendToSelf() }}><Plus size={19} /></button>
      </div>
      <button type="button" className="arkme-redesign-chat-search" onClick={() => { selectRoute('search') }}>
        <MagnifyingGlass size={16} />
        <span>搜索对话或消息</span>
      </button>
      <div className="arkme-redesign-chat-directory">
        <ArkmeNavigation
          wide
          embeddedProductShell
          currentSessionId={sessionState.current}
          onActivateSurface={() => undefined}
          renderSlot={renderSlot}
        />
      </div>
    </aside>}

    <main className={`arkme-redesign-content${hasSecondaryPanel ? ' has-panel' : ''}${layoutState.detailsOpen ? ' has-details' : ''}`}>
      {route === 'tasks'
        ? showTaskStart
          ? <TaskStart
            busy={sending || preparingSession}
            error={promptError}
            workspaceLabel={taskWorkspaceLabel}
            onChooseWorkspace={() => { requestTaskSession() }}
            onRun={text => {
            if (current === undefined) {
              requestTaskSession(text)
            } else {
              void runPrompt(current.id, text)
            }
          }} />
          : renderSlot('conversation', {})
        : route === 'chats'
          ? <div className="arkme-redesign-route-surface arkme-redesign-route-chats"><ArkmeSurface productChrome={false} /></div>
          : route === 'recordings'
            ? <section className="arkme-redesign-feature-page arkme-redesign-recordings-page">
              <div className="arkme-redesign-feature-body"><ArkmeRecordingSurface /></div>
            </section>
            : route === 'search'
              ? <section className="arkme-redesign-feature-page arkme-redesign-search-page">
                <header><p>搜索</p><h1>一句话，找到所有内容</h1><span>对话、录音和任务会一起搜索。</span></header>
                <div className="arkme-redesign-feature-body"><ArkmeSearchSurface /></div>
              </section>
              : route === 'calendar'
                ? <div className="arkme-redesign-route-surface arkme-redesign-calendar-page"><ArkmeCalendarSurface /></div>
              : route === 'plugins'
                ? <section className="arkme-redesign-feature-page arkme-redesign-plugins-page">
                  <header><p>插件</p><h1>扩展 Arkme 的能力</h1><span>安装后直接告诉 Arkme 你想完成什么。</span></header>
                  <div className="arkme-redesign-feature-body">
                    <ArkmeExtensionCenter
                      embedded
                      currentSessionId={sessionState.current}
                      {...(authState.auth?.status === 'authenticated' && authState.auth.userId !== undefined
                        ? { currentUserId: authState.auth.userId }
                        : {})}
                      onClose={() => undefined}
                    />
                  </div>
                </section>
                : <section className="arkme-redesign-feature-page arkme-redesign-settings-page">
                  <header><p>设置</p><h1>Arkme 设置</h1><span>管理账号、版本与插件运行状态。</span></header>
                  <div className="arkme-redesign-settings-card"><ArkmeSettingsRow useSessions={useSessions} useWorkspaces={useWorkspaces} /></div>
                </section>}
    </main>

    {route === 'tasks' && layoutState.detailsOpen && <aside className="arkme-redesign-details">
      {renderSlot('details', {})}
    </aside>}
    <div className="arkme-redesign-overlays" data-shell-overlay>
      {renderSlot('shell.overlay', {})}
    </div>
    <ArkmeWorkspaceDialog
      open={workspaceDialogOpen}
      busy={preparingSession}
      listDirectory={listDirectory}
      onCancel={() => { setWorkspaceDialogOpen(false); setPendingTaskPrompt(undefined) }}
      onSelect={path => {
        void prepareTaskSession({ path }).then(sessionId => {
          if (sessionId === undefined) return
          setWorkspaceDialogOpen(false)
          const prompt = pendingTaskPrompt
          setPendingTaskPrompt(undefined)
          if (prompt !== undefined) void runPrompt(sessionId, prompt)
        })
      }}
    />
  </div>
}
