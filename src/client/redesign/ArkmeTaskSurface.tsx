import { useRef, useState, type FormEvent } from 'react'
import { ArrowUp } from '@phosphor-icons/react/ArrowUp'
import { CaretDown } from '@phosphor-icons/react/CaretDown'
import { FileText } from '@phosphor-icons/react/FileText'
import { Microphone } from '@phosphor-icons/react/Microphone'
import { Paperclip } from '@phosphor-icons/react/Paperclip'
import { Plus } from '@phosphor-icons/react/Plus'
import { SquaresFour } from '@phosphor-icons/react/SquaresFour'
import { Waveform } from '@phosphor-icons/react/Waveform'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { ARKME_WORDMARK_DATA_URL } from '../arkme-wordmark.js'

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

export function ArkmeTaskDirectory({
  sessions, selected, onNew, onOpen,
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

export function ArkmeTaskStart({ busy, error, onChooseWorkspace, onBrowsePlugins, onRun }: {
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
  return <section className="arkme-redesign-task-start" aria-label="开始 Arkme 任务">
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
          if (title === '试试插件') onBrowsePlugins()
          else { setPrompt(value); inputRef.current?.focus() }
        }}>
          <span className="arkme-redesign-starter-icon"><Icon size={20} /></span>
          <span><strong>{title}</strong><small>{detail}</small></span>
        </button>)}
      </div>
    </div>
  </section>
}
