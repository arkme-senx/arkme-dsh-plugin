import {fitCodexReadingWindow} from './codex-reading-window.js'
import {codexAccessRevoked} from '../../../team-codex-access.js'
import { arkmeAuthStore } from '../../auth-store.js'
import { CodexSelectableBody, useCodexMessageInteractions } from './CodexMessageInteractions.js'
import { codexSelectable } from './codex-message-actions.js'
import { arkmeTheme } from '../../arkme-theme.js'
import { Children, isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { callArkme } from '../../api.js'
import { arkmeMarkdownStyles } from '../../ArkmeMarkdownBody.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../../locale.js'
import { compareCodexEvents } from '../../../team-codex-contract.js'
import type { TeamCodexEvent, TeamCodexEventPage, TeamCodexTask } from '../../../team-codex-contract.js'
import { codexPromptPresentation, type CodexQuestionReply } from '../../../team-codex-prompt-text.js'
import { codexCollectorUnavailable } from './CodexSyncStatus.js'
import { CodexTurnDuration } from './CodexTurnDuration.js'
import { CodexPrivateImages } from './CodexPrivateImages.js'
import { codexImageSafeText } from '../../../team-codex-image-text.js'

export interface CodexReadingState {
  items: TeamCodexEvent[]
  before?: number | undefined
  cursor?: string | undefined
  loaded: boolean
  scrollTop: number
  atBottom: boolean
  newer?:boolean
}
export const newCodexReadingState = (): CodexReadingState => ({ items: [], loaded: false, scrollTop: 0, atBottom: true })
export const codexReadingKey = (teamRef: string, task: TeamCodexTask): string => JSON.stringify([teamRef, task.cloud?.sourceId ?? 'local', task.cloud?.taskId ?? task.id])
const stamp = (at: number) => new Date(at).toLocaleString(arkmeIntlLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const dayKey = (at: number) => { const date = new Date(at); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` }

export function mergeCodexEvents(current: TeamCodexEvent[], incoming: TeamCodexEvent[]): TeamCodexEvent[] {
  const byId = new Map(current.map(item => [item.eventId ?? item.sequence, item]))
  for (const item of incoming) {
    const previous = byId.get(item.eventId ?? item.sequence)
    if (!previous || (item.version ?? 0) >= (previous.version ?? 0)) byId.set(item.eventId ?? item.sequence, item)
  }
  return [...byId.values()].sort(compareCodexEvents)
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
export const CodexMessageBody = memo(function CodexMessageBody({ text }: { text: string }) {
  useArkmeLocale()
  return <div className="arkme-markdown arkme-codex-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]} skipHtml components={{
    a: ({ href, children }) => href && /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: () => <span className="arkme-codex-media-note">[{tr('图片仅本人可见')}]</span>,
    table: ({ children }) => <div className="arkme-markdown-table"><table>{children}</table></div>,
    pre: ({ children }) => <div className="arkme-codex-code"><div className="arkme-codex-code-toolbar"><span aria-hidden="true">{tr('代码')}</span><CodexCopyButton value={plain(children).replace(/\n$/, '')} label={tr('复制代码')}/></div><pre>{children}</pre></div>,
    input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label={tr(checked ? '已完成' : '未完成')}/>,
  }}>{text}</Markdown></div>
})

interface CodexConversationProps { teamRef: string; task: TeamCodexTask; reading: CodexReadingState; inputName: string; children?: ReactNode|((detail:TeamCodexTask)=>ReactNode) }
function visiblePrompt(raw: string) {
  const prompt = codexPromptPresentation(raw)
  return { text: codexImageSafeText(prompt.text), ...(prompt.replies ? {
    replies: prompt.replies.map(reply => ({ question: codexImageSafeText(reply.question), answer: codexImageSafeText(reply.answer) })),
  } : {}) }
}
function CodexPromptBody({ text, replies }: { text: string; replies?: CodexQuestionReply[] | undefined }) {
  if (!replies) return <div className="arkme-codex-user-text">{text || tr('无文本输入')}</div>
  return <div className="arkme-codex-question-replies">{replies.map((reply,index) =>
    <section className="arkme-codex-question-reply" aria-label={tr('问题与回答')} key={index}>
      <p className="arkme-codex-question-text" data-arkme-quote-prose><span className="arkme-codex-question-label">{tr('问题')}：</span>{reply.question}</p>
      <div className="arkme-codex-question-answer">
        {reply.answer && <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 10 4 4 8-9"/></svg>}
        <p data-arkme-quote-prose><span className="arkme-codex-question-label">{tr('你的回答')}：</span>{reply.answer || tr('未填写回答')}</p>
      </div>
      {reply.answer && <small className="arkme-codex-question-status" aria-hidden="true">{tr('已回答')}</small>}
    </section>)}</div>
}
export function TeamCodexConversation(props: CodexConversationProps) {
  const auth=useSyncExternalStore(arkmeAuthStore.subscribe,arkmeAuthStore.getSnapshot,arkmeAuthStore.getSnapshot).auth
  const userId=auth?.status==='authenticated'?auth.userId:undefined
  const account=userId?`${auth!.environment}:${userId}`:''
  return <CodexConversationReader key={`${account}:${codexReadingKey(props.teamRef,props.task)}`} {...props} account={account} userId={userId}/>
}
function CodexConversationReader({ teamRef, task, reading, inputName, children, account, userId }: CodexConversationProps & { account:string;userId:number|undefined }) {
  const [items, setItems] = useState(reading.items)
  const [detailQueue,setDetailQueue]=useState<TeamCodexTask['queue']>()
  const [detailQueueCloud,setDetailQueueCloud]=useState<TeamCodexTask['queueCloud']>()
  const detailTask={...task}
  if(detailQueueCloud){detailTask.queueCloud=detailQueueCloud;if(detailQueue)detailTask.queue=detailQueue;else delete detailTask.queue}

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
  const pendingScroll = useRef<'restore' | 'bottom' | { top: number; height: number;key?:string;offset?:number }>('restore')
  const rememberScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    reading.scrollTop = el.scrollTop
    reading.atBottom = !reading.newer && el.scrollHeight - el.clientHeight - el.scrollTop < 56
    setAwayFromBottom(!reading.atBottom)
    if (reading.atBottom) setNewContent(false)
  }, [reading])
  const load = useCallback(async (older?: number | string,mode:'refresh'|'newer'|'latest'='refresh') => {
    if (loading.current) return
    loading.current = true
    const controller = new AbortController()
    controllers.current.add(controller)
    setBusy(true)
    try {
      const params={teamRef,id:task.id,...(task.cloud?.remote?{sourceId:task.cloud.sourceId}:{})}
      const request=(bounds:Record<string,unknown>)=>callArkme<TeamCodexEventPage>('team.codex.events',{...params,...bounds},controller.signal)
      const previous=reading.items
      const first=previous[0]?.cursor,last=previous.at(-1)?.cursor
      const forward=mode==='newer'
      let page=await request(forward&&last?{after:last}:typeof older==='string'?{cursor:older}:typeof older==='number'?{before:older}:{})
      if(page.queueCloud){setDetailQueue(page.queue);setDetailQueueCloud(page.queueCloud)}
      let nextItems=page.items,newer=reading.newer??false
      if(mode==='latest'){newer=false}
      else if(mode==='refresh'&&older===undefined&&first&&last){
        // Revalidate only the bounded reading window. Never chase the entire tail/history.
        let continuation:string|undefined,round=0;const values:TeamCodexEvent[]=[],seen=new Set<string>()
        do{
          const next=await request({from:first,through:last,...(continuation?{cursor:continuation}:{})})
          controller.signal.throwIfAborted();values.push(...next.items);continuation=next.nextCursor
          if(continuation&&seen.has(continuation))throw Error('工作动态分页异常，请重试')
          if(continuation)seen.add(continuation)
        }while(continuation&&++round<4)
        nextItems=values
        if(!newer){const next=await request({after:last});nextItems.push(...next.items);newer=!!next.nextCursor}
        if(continuation)newer=true
        if(reading.atBottom&&newer){nextItems=page.items;newer=false;mode='latest'}
        else if(page.items.at(-1)?.cursor!==last&&reading.loaded&&!reading.atBottom)setNewContent(true)
      }
      if(!live.current||controller.signal.aborted)return
      const merged=mode==='latest'?nextItems:mergeCodexEvents(previous,nextItems)
      const edge=older!==undefined||!reading.atBottom&&!forward&&mode!=='latest'?'older':'newer'
      const fitted=fitCodexReadingWindow(merged,edge)
      if(forward)newer=!!page.nextCursor
      if(fitted.dropped&&edge==='older')newer=true
      const el=scroller.current
      if(el&&(older!==undefined||forward||!reading.atBottom&&mode!=='latest')){
        const rect=el.getBoundingClientRect(),anchor=Array.from(el.querySelectorAll<HTMLElement>('[data-codex-row]')).find(node=>{const r=node.getBoundingClientRect();return r.height>0&&r.bottom>rect.top})
        pendingScroll.current={top:el.scrollTop,height:el.scrollHeight,...(anchor?{key:anchor.dataset.codexRow!,offset:(anchor.querySelector<HTMLElement>('article')??anchor).getBoundingClientRect().top-rect.top}:{})}
      }else pendingScroll.current=mode==='latest'||reading.atBottom?'bottom':'restore'
      const previousById=new Map(previous.map(item=>[item.eventId??item.sequence,item]))
      const messageChanged=fitted.items.some(item=>{const old=previousById.get(item.eventId??item.sequence);return !old||old.text!==item.text||old.kind!==item.kind||JSON.stringify(old.localProgress)!==JSON.stringify(item.localProgress)})
      if(messageChanged&&reading.loaded&&older===undefined&&!reading.atBottom&&mode!=='newer')setNewContent(true)
      if(!reading.loaded||older!==undefined||mode==='latest'){
        reading.before=page.nextBefore;reading.cursor=page.nextCursor
      }
      if(fitted.dropped&&edge==='newer'){
        reading.cursor=fitted.items[0]?.cursor
        if(!reading.cursor)reading.before=fitted.items[0]?.sequence
      }
      if(mode==='latest'){reading.atBottom=true;setNewContent(false);setAwayFromBottom(false)}
      reading.newer=newer;reading.items=fitted.items;reading.loaded=true
      setBefore(reading.before);setCursor(reading.cursor);setItems(fitted.items)
      setError('')
    } catch (failure) {
      if (!live.current || controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : tr('工作动态加载失败，请重试'))
      // Explicit denial clears content; a transient network/service error retains the reading window.
      if (task.cloud?.remote && codexAccessRevoked(failure)) {setDetailQueue(undefined);setDetailQueueCloud('private'); reading.items = []; reading.loaded = false; reading.before = undefined; reading.cursor = undefined; reading.newer=false; setItems([]); setBefore(undefined); setCursor(undefined) }
    } finally {
      controllers.current.delete(controller); loading.current = false
      if (live.current && !controller.signal.aborted) setBusy(false)
    }
  }, [teamRef, task.id, task.cloud?.remote, task.cloud?.sourceId, reading])
  useEffect(() => {
    live.current = true
    void load()
    const timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void load() }, 5000)
    const foreground=()=>{if(typeof document==='undefined'||!document.hidden)void load()}
    if(typeof window!=='undefined'){window.addEventListener('focus',foreground);window.addEventListener('online',foreground);window.addEventListener('arkme-codex-changed',foreground)}
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',foreground)
    return () => {
      live.current=false;clearInterval(timer);for(const controller of controllers.current)controller.abort()
      if(typeof window!=='undefined'){window.removeEventListener('focus',foreground);window.removeEventListener('online',foreground);window.removeEventListener('arkme-codex-changed',foreground)}
      if(typeof document!=='undefined')document.removeEventListener('visibilitychange',foreground)
    }
  }, [load])
  useEffect(() => { void load() }, [load, task.updatedAt, task.eventCount])
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const pending = pendingScroll.current
    if(typeof pending==='object'){
      const anchor=pending.key?Array.from(el.querySelectorAll<HTMLElement>('[data-codex-row]')).find(node=>node.dataset.codexRow===pending.key):undefined
      el.scrollTop=anchor&&pending.offset!==undefined?el.scrollTop+(anchor.querySelector<HTMLElement>('article')??anchor).getBoundingClientRect().top-el.getBoundingClientRect().top-pending.offset:pending.top+el.scrollHeight-pending.height
    }else el.scrollTop=pending==='bottom'||pending==='restore'&&reading.atBottom?el.scrollHeight:reading.scrollTop
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
  // Project cached/local/cloud history alike; copying must use the same visible text.
  const visibleItems = useMemo(() => items.map(event => ({...event,...(event.kind === 'UserPromptSubmit'
    ? visiblePrompt(event.text) : {text:codexImageSafeText(event.text)})})), [items])
  const currentPrompt = current ? visiblePrompt(current.text) : undefined
  const interactions=useCodexMessageInteractions({teamRef,task,events:visibleItems,account,userId})
  const latest=visibleItems.at(-1)
  const workingTiming=task.state==='working' && latest?.kind==='UserPromptSubmit'
    && (!task.currentInput || task.currentInput.turnId===latest.turnId) ? latest.timing : undefined
  return <div className="arkme-codex-transcript-wrap" data-codex-source={interactions.sourceRef}>
    <style>{arkmeMarkdownStyles}</style>
    <div className="arkme-codex-reader-viewport">
    <div ref={scroller} className="arkme-codex-transcript" aria-label={tr('任务对话记录')} tabIndex={0} onScroll={()=>{rememberScroll();const el=scroller.current;if(reading.newer&&el&&el.scrollHeight-el.clientHeight-el.scrollTop<180)void load(undefined,'newer')}}>
      <div className="arkme-codex-reading-column">
        {(before !== undefined || cursor !== undefined) && <button type="button" className="arkme-codex-older" disabled={busy} onClick={() => { void load(cursor ?? before) }}>{tr('加载更早记录')}</button>}
        {error && <p role="alert">{error} <button type="button" onClick={() => { void load() }}>{tr('重试')}</button></p>}
        {!items.length && !current && !error && <p className="arkme-codex-transcript-empty" role="status">{tr(busy ? '加载中…' : '收到这项任务的新输入或回答后，会显示在这里。')}</p>}
        {visibleItems.map((event, index) => <div key={event.eventId ?? event.sequence} data-codex-row={String(event.eventId??event.sequence)}>
          {(index === 0 || dayKey(items[index - 1]!.at) !== dayKey(event.at)) && <div className="arkme-codex-date">{new Date(event.at).toLocaleDateString(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' })}</div>}
          {event.kind!=='UserPromptSubmit' && event.timing && <CodexTurnDuration timing={event.timing} task={task}/>}
          <article onContextMenu={e=>interactions.contextMenu(event,e)} onClick={e=>{if(interactions.selecting&&codexSelectable(event)&&!(e.target as Element).closest('button,a,input')&&!document.getSelection()?.toString()){interactions.toggle(event)}}} style={interactions.selecting&&codexSelectable(event)?{display:'grid',gridTemplateColumns:'32px minmax(0,1fr)',gap:10,background:interactions.selected(event)?arkmeTheme.active:undefined}:undefined} className={`arkme-codex-message ${event.kind === 'UserPromptSubmit' ? 'is-user' : event.kind === 'Interrupt' ? 'is-interrupt' : 'is-assistant'}`} data-event-kind={event.kind} aria-label={event.kind === 'UserPromptSubmit' ? inputName : tr(event.kind === 'Stop' ? 'Codex 回答' : event.kind==='Progress'?'Codex 过程回复':'任务已中断')}>
            {interactions.check(event)}<div style={{minWidth:0}}>
            <CodexSelectableBody sourceRef={interactions.sourceRef} event={event} inputName={inputName}>{event.kind === 'Interrupt' ? <div className="arkme-codex-interrupted">{tr('任务已中断')}{event.text && <span> · {event.text}</span>}</div>
              : event.text ? event.kind === 'UserPromptSubmit' ? <CodexPromptBody text={event.text} replies={event.replies}/> : <CodexMessageBody text={event.text}/>
                : <p>{tr(event.kind === 'Stop' ? '本轮已结束，未收到回答文本。' : '无文本输入')}</p>}</CodexSelectableBody>
            <CodexPrivateImages teamRef={teamRef} task={task} event={event}/>
            {event.truncated && <small>{tr('正文已截断；完整内容请在来源电脑的 Codex 查看。')}</small>}
            <footer className="arkme-codex-message-meta"><time dateTime={new Date(event.at).toISOString()}>{stamp(event.at)}</time>{event.text && <CodexCopyButton value={event.text} label={tr(event.kind === 'UserPromptSubmit' ? '复制输入' : '复制回答')}/>}</footer></div>
          </article>
          {event.localProgress?.map(progress=><article key={progress.id} className="arkme-codex-message is-assistant" data-event-kind="Progress" aria-label={tr('Codex 进度')}>
            <CodexMessageBody text={progress.text}/>
            {progress.truncated&&<small>{tr('正文已截断；完整内容请在来源电脑的 Codex 查看。')}</small>}
            <footer className="arkme-codex-message-meta"><span>{tr('过程回复 · 仅本机')}</span><time dateTime={new Date(progress.at).toISOString()}>{stamp(progress.at)}</time><CodexCopyButton value={progress.text} label={tr('复制进度')}/></footer>
          </article>)}
        </div>)}
        {currentPrompt && <article className="arkme-codex-message is-user" aria-label={inputName}><CodexPromptBody {...currentPrompt}/><footer className="arkme-codex-message-meta">{tr('当前请求')}</footer></article>}
        {workingTiming && <CodexTurnDuration timing={workingTiming} task={task}/>}
        {task.state === 'working' && !workingTiming && <p className="arkme-codex-run-status" role="status"><span className="arkme-codex-state-dot" data-working={!task.cloud?.remote&&!codexCollectorUnavailable(task)}/>{tr(codexCollectorUnavailable(task) || task.cloud?.remote ? '尚未收到本轮结束状态，请查看同步状态。' : '等待同步本轮回答…')}</p>}
      </div>
    </div>
    {awayFromBottom && <button type="button" className="arkme-codex-jump" onClick={() => { if(reading.newer){void load(undefined,'latest');return}const el=scroller.current;if(el){el.scrollTop=el.scrollHeight;rememberScroll()} }}>{tr(newContent ? '有新内容 ↓' : '回到最新 ↓')}</button>}
    </div>
    {interactions.host}
    {interactions.feedback}
    <div style={{position:'relative',flex:'none',minHeight:interactions.selecting?110:undefined}}><div style={{visibility:interactions.selecting?'hidden':undefined}} aria-hidden={interactions.selecting?true:undefined}>{typeof children==='function'?children(detailTask):children}</div>{interactions.dock}</div>

  </div>
}
