import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { callArkme } from '../../api.js'
import { arkmeMarkdownStyles } from '../../ArkmeMarkdownBody.js'
import { arkmeIntlLocale, tr } from '../../locale.js'
import type { TeamCodexEvent, TeamCodexEventPage, TeamCodexTask } from '../../../team-codex-contract.js'

export interface CodexReadingState {
  items: TeamCodexEvent[]
  before?: number | undefined
  cursor?: string | undefined
  loaded: boolean
  scrollTop: number
  atBottom: boolean
}
export const newCodexReadingState = (): CodexReadingState => ({ items: [], loaded: false, scrollTop: 0, atBottom: true })
export const codexReadingKey = (teamRef: string, task: TeamCodexTask): string => JSON.stringify([teamRef, task.cloud?.remote ? task.cloud.sourceId : 'local', task.id])
const stamp = (at: number) => new Date(at).toLocaleString(arkmeIntlLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const dayKey = (at: number) => { const date = new Date(at); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` }

export function mergeCodexEvents(current: TeamCodexEvent[], incoming: TeamCodexEvent[]): TeamCodexEvent[] {
  const byId = new Map(current.map(item => [item.eventId ?? item.sequence, item]))
  for (const item of incoming) {
    const previous = byId.get(item.eventId ?? item.sequence)
    if (!previous || (item.version ?? 0) >= (previous.version ?? 0)) byId.set(item.eventId ?? item.sequence, item)
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence)
}
function plain(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? plain(child.props.children) : '').join('')
}

export function CodexCopyButton({ value, label }: { value: string; label: string }) {
  const [result, setResult] = useState<'copied' | 'error'>()
  useEffect(() => { setResult(undefined) }, [value])
  useEffect(() => { if (!result) return; const timer = setTimeout(() => setResult(undefined), 2000); return () => clearTimeout(timer) }, [result])
  return <span className="arkme-codex-copy-control"><button type="button" className="arkme-codex-copy" aria-label={label} title={label} onClick={() => {
    void (async () => { try { await navigator.clipboard.writeText(value); setResult('copied') } catch { setResult('error') } })()
  }}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    {result === 'copied' ? <path d="m4 10 4 4 8-9"/> : <><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"/></>}
  </svg></button>{result && <small role="status">{tr(result === 'copied' ? '已复制' : '复制失败，请手动选择文本')}</small>}</span>
}

/** Read-only remote text. No business-link fetching, HTML, image requests or local file navigation. */
export function CodexMessageBody({ text }: { text: string }) {
  return <div className="arkme-markdown arkme-codex-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml components={{
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span className="arkme-codex-media-note">[{alt || tr('图片')} · {tr('图片未同步')}]</span>,
    table: ({ children }) => <div className="arkme-markdown-table"><table>{children}</table></div>,
    pre: ({ children }) => <div className="arkme-codex-code"><div className="arkme-codex-code-toolbar"><span>{tr('代码')}</span><CodexCopyButton value={plain(children).replace(/\n$/, '')} label={tr('复制代码')}/></div><pre>{children}</pre></div>,
    input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label={tr(checked ? '已完成' : '未完成')}/>,
  }}>{text}</Markdown></div>
}

export function TeamCodexConversation({ teamRef, task, reading, inputName }: {
  teamRef: string; task: TeamCodexTask; reading: CodexReadingState; inputName: string
}) {
  const [items, setItems] = useState(reading.items)
  const [before, setBefore] = useState(reading.before)
  const [cursor, setCursor] = useState(reading.cursor)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newContent, setNewContent] = useState(false)
  const [awayFromBottom, setAwayFromBottom] = useState(!reading.atBottom)
  const scroller = useRef<HTMLDivElement>(null)
  const live = useRef(true)
  const loading = useRef(false)
  const controllers = useRef(new Set<AbortController>())
  const pendingScroll = useRef<'restore' | 'bottom' | { top: number; height: number }>('restore')
  const rememberScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    reading.scrollTop = el.scrollTop
    reading.atBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 56
    setAwayFromBottom(!reading.atBottom)
    if (reading.atBottom) setNewContent(false)
  }, [reading])
  const load = useCallback(async (older?: number | string) => {
    if (loading.current) return
    loading.current = true
    const controller = new AbortController()
    controllers.current.add(controller)
    setBusy(true)
    try {
      const page = await callArkme<TeamCodexEventPage>('team.codex.events', { teamRef, id: task.id,
        ...(task.cloud?.remote ? { sourceId: task.cloud.sourceId, cursor: typeof older === 'string' ? older : '' } : typeof older === 'number' ? { before: older } : {}),
      }, controller.signal)
      if (!live.current || controller.signal.aborted) return
      const merged = mergeCodexEvents(reading.items, page.items)
      const changed = JSON.stringify(merged) !== JSON.stringify(reading.items)
      if (older !== undefined && scroller.current) pendingScroll.current = { top: scroller.current.scrollTop, height: scroller.current.scrollHeight }
      else pendingScroll.current = reading.atBottom ? 'bottom' : 'restore'
      if (changed && reading.loaded && older === undefined && !reading.atBottom) setNewContent(true)
      if (!reading.loaded || older !== undefined) {
        reading.before = page.nextBefore; reading.cursor = page.nextCursor
        setBefore(page.nextBefore); setCursor(page.nextCursor)
      }
      reading.items = merged; reading.loaded = true
      if (changed) setItems(merged)
      setError('')
    } catch (failure) {
      if (!live.current || controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : tr('工作动态加载失败，请重试'))
      // Do not keep readable remote content after a failed permission revalidation.
      if (task.cloud?.remote) { reading.items = []; reading.loaded = false; reading.before = undefined; reading.cursor = undefined; setItems([]); setBefore(undefined); setCursor(undefined) }
    } finally {
      controllers.current.delete(controller); loading.current = false
      if (live.current && !controller.signal.aborted) setBusy(false)
    }
  }, [teamRef, task.id, task.cloud?.remote, task.cloud?.sourceId, reading])
  useEffect(() => {
    live.current = true
    void load()
    const timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void load() }, 5000)
    return () => { live.current = false; clearInterval(timer); for (const controller of controllers.current) controller.abort() }
  }, [load])
  useEffect(() => { void load() }, [load, task.updatedAt, task.eventCount])
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const pending = pendingScroll.current
    el.scrollTop = typeof pending === 'object' ? pending.top + el.scrollHeight - pending.height
      : pending === 'bottom' || (pending === 'restore' && reading.atBottom) ? el.scrollHeight : reading.scrollTop
    pendingScroll.current = 'restore'
    rememberScroll()
  }, [items, reading, rememberScroll])
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (reading.atBottom) { el.scrollTop = el.scrollHeight; reading.scrollTop = el.scrollTop } })
    observer.observe(el)
    return () => observer.disconnect()
  }, [reading])
  const current = task.state === 'working' && task.currentInput && !items.some(item => item.turnId === task.currentInput?.turnId && item.kind === 'UserPromptSubmit') ? task.currentInput : undefined
  return <div className="arkme-codex-transcript-wrap">
    <style>{arkmeMarkdownStyles}</style>
    <div ref={scroller} className="arkme-codex-transcript" aria-label={tr('任务对话记录')} tabIndex={0} onScroll={rememberScroll}>
      <div className="arkme-codex-reading-column">
        {(before !== undefined || cursor !== undefined) && <button type="button" className="arkme-codex-older" disabled={busy} onClick={() => { void load(cursor ?? before) }}>{tr('加载更早记录')}</button>}
        {error && <p role="alert">{error} <button type="button" onClick={() => { void load() }}>{tr('重试')}</button></p>}
        {!items.length && !current && !error && <p className="arkme-codex-transcript-empty" role="status">{tr(busy ? '加载中…' : '收到这项任务的新输入或回答后，会显示在这里。')}</p>}
        {items.map((event, index) => <div key={event.eventId ?? event.sequence}>
          {(index === 0 || dayKey(items[index - 1]!.at) !== dayKey(event.at)) && <div className="arkme-codex-date">{new Date(event.at).toLocaleDateString(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}</div>}
          <article className={`arkme-codex-message ${event.kind === 'UserPromptSubmit' ? 'is-user' : event.kind === 'Interrupt' ? 'is-interrupt' : 'is-assistant'}`} data-event-kind={event.kind} aria-label={event.kind === 'UserPromptSubmit' ? inputName : tr(event.kind === 'Stop' ? 'Codex 回答' : '任务已中断')}>
            {event.kind === 'Interrupt' ? <div className="arkme-codex-interrupted">{tr('任务已中断')}{event.text && <span> · {event.text}</span>}</div>
              : event.text ? event.kind === 'UserPromptSubmit' ? <div className="arkme-codex-user-text">{event.text}</div> : <CodexMessageBody text={event.text}/>
                : <p>{tr(event.kind === 'Stop' ? '本轮已结束，未收到回答文本。' : '无文本输入')}</p>}
            {event.truncated && <small>{tr('正文已截断；完整内容请在来源电脑的 Codex 查看。')}</small>}
            <footer className="arkme-codex-message-meta"><time dateTime={new Date(event.at).toISOString()}>{stamp(event.at)}</time>{event.text && <CodexCopyButton value={event.text} label={tr(event.kind === 'UserPromptSubmit' ? '复制输入' : '复制回答')}/>}</footer>
          </article>
        </div>)}
        {current && <article className="arkme-codex-message is-user" aria-label={inputName}><div className="arkme-codex-user-text">{current.text || tr('无文本输入')}</div><footer className="arkme-codex-message-meta">{tr('当前请求')}</footer></article>}
        {task.state === 'working' && <p className="arkme-codex-run-status" role="status"><span className="arkme-codex-state-dot" data-working="true"/>{tr('等待同步本轮回答…')}</p>}
      </div>
    </div>
    {awayFromBottom && <button type="button" className="arkme-codex-jump" onClick={() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; rememberScroll() } }}>{tr(newContent ? '有新内容 ↓' : '回到最新 ↓')}</button>}
  </div>
}
