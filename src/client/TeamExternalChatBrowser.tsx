import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { LinkBreak } from '@phosphor-icons/react/dist/icons/LinkBreak'
import { LockSimple } from '@phosphor-icons/react/dist/icons/LockSimple'
import type { ArkmeTimelineItem } from '../types.js'
import type { ExternalChatDirectory, ExternalChatShare, ExternalChatTimeline } from '../team-external-chat-contract.js'
import { callArkme } from './api.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMediaAccessContext } from './media-access.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { ArkmeReadTimeoutError, withArkmeReadDeadline } from './read-deadline.js'
import { externalChatWriteUncertain, saveExternalChatWithDeadline } from './team-external-chat-request.js'

const failure = (error: unknown) => error instanceof Error ? error.message : tr('加载失败，请重试')
const transportFailure = (error: unknown) => error instanceof ArkmeReadTimeoutError
  || ['local-network-unavailable', 'local-response-invalid'].includes((error as {body?: {code?: string}} | null)?.body?.code ?? '')

function Avatar({name, side = 'peer', small = false}: {name: string; side?: string; small?: boolean}) {
  return <span aria-hidden="true" className={`arkme-external-avatar${small ? ' is-small' : ''}`} data-side={side}>{[...name.trim()].slice(0, 2).join('') || '?'}</span>
}
function Skeleton({messages = false}: {messages?: boolean}) {
  return <div className={`arkme-external-skeleton${messages ? ' is-messages' : ''}`} role="status" aria-label={tr('正在加载对外私聊')}>
    {[0, 1, 2, 3].map(i => <div key={i} className="arkme-external-skeleton-row" data-right={messages && i % 2 === 1} aria-hidden="true"><i/><span><b/><b/></span></div>)}
  </div>
}
function Empty({title, children}: {title: string; children?: React.ReactNode}) {
  return <div className="arkme-external-empty"><ChatCircle size={36} weight="light" aria-hidden/><strong>{title}</strong>{children}</div>
}
function ReadError({message, retry}: {message: string; retry(): void}) {
  return <div className="arkme-external-error" role="alert"><span>{message}</span><button type="button" onClick={retry}>{tr('重试')}</button></div>
}

export function TeamExternalChats(props: {teamRef: string; teamKey?: string | undefined; teamName: string; onClose(): void}) {
  return <Directory key={props.teamKey ?? props.teamRef} {...props}/>
}
function Directory({teamRef, teamName, onClose}: {teamRef: string; teamName: string; onClose(): void}) {
  useArkmeLocale()
  const [page, setPage] = useState<ExternalChatDirectory>()
  const [selected, setSelected] = useState<ExternalChatShare>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<ExternalChatShare>()
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const request = useRef<AbortController>()
  const mutation = useRef<AbortController>()
  async function load(cursor?: string) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError('')
    try {
      const next = await withArkmeReadDeadline(signal => callArkme<ExternalChatDirectory>('team.app.external.list', {teamRef, ...(cursor ? {cursor} : {})}, signal), controller.signal)
      if (controller.signal.aborted) return
      setPage(old => cursor && old ? {...next, items: [...new Map([...old.items, ...next.items].map(share => [share.key, share])).values()]} : next)
      setNeedsReload(false); setMutationError(''); setPending(undefined)
      if (!cursor) setSelected(old => old
        ? next.items.find(share => share.key === old.key) ?? (next.hasMore ? old : undefined)
        : next.items.length === 1 && !next.hasMore ? next.items[0] : undefined)
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(failure(error))
        if (!transportFailure(error)) {setPage(undefined); setSelected(undefined)}
      }
    } finally {if (!controller.signal.aborted) setLoading(false)}
  }
  useEffect(() => {void load(); return () => request.current?.abort()}, [teamRef])
  useEffect(() => () => mutation.current?.abort(), [])
  async function unshare() {
    if (!pending || mutating || mutation.current) return
    const target = pending, controller = new AbortController()
    mutation.current = controller
    setMutating(true); setMutationError('')
    try {
      await saveExternalChatWithDeadline(signal => callArkme('team.app.external.unshare', {shareRef: target.ref}, signal), controller.signal)
      if (controller.signal.aborted) return
      setPage(old => old ? {...old, items: old.items.filter(share => share.key !== target.key)} : old)
      setSelected(old => old?.key === target.key ? undefined : old)
      setPending(undefined)
    } catch (error) {
      if (!controller.signal.aborted) {
        const uncertain = externalChatWriteUncertain(error)
        setNeedsReload(uncertain)
        setMutationError(uncertain ? tr('保存结果尚未确认，请重新加载后核对。') : failure(error))
      }
    } finally {
      if (mutation.current === controller) mutation.current = undefined
      if (!controller.signal.aborted) setMutating(false)
    }
  }
  const groups = new Map<string, ExternalChatShare[]>()
  for (const share of page?.items ?? []) groups.set(share.sharerKey, [...(groups.get(share.sharerKey) ?? []), share])
  return <TeamFeatureDialog className="arkme-team-external-browser" title={tr('对外私聊')} teamName={teamName} busy={mutating} onClose={onClose}>
    <div className="arkme-external-workspace" data-reading={!!selected}>
      <aside className="arkme-external-directory" aria-label={tr('共享私聊列表')}>
        <div className="arkme-external-directory-heading"><span>{tr('共享私聊')}{page && <small>{page.items.length}{page.hasMore ? '+' : ''}</small>}</span><button type="button" className="arkme-external-icon" disabled={loading || mutating} aria-label={tr('刷新对外私聊')} title={tr('刷新')} onClick={() => void load()}><ArrowClockwise size={18} className={loading ? 'is-spinning' : ''}/></button></div>
        <div className="arkme-external-directory-scroll">
          {error && <ReadError message={error} retry={() => void load()}/>}
          {!page && loading && <Skeleton/>}
          {page && !page.items.length && <Empty title={tr('暂无对外私聊')}><span>{tr('在个人私聊的更多菜单中共享到团队')}</span></Empty>}
          {[...groups].map(([key, shares]) => <section key={key} className="arkme-external-group"><h3><Avatar name={shares[0]?.sharerName ?? ''} side="sharer" small/><span>{shares[0]?.sharerName}</span></h3>{shares.map(share => <div key={share.key} className="arkme-external-chat-row" data-selected={selected?.key === share.key}>
            <button type="button" className="arkme-external-open" aria-label={tr('查看与 {name} 的私聊', {name: share.peerName})} aria-current={selected?.key === share.key ? 'true' : undefined} onClick={() => setSelected(share)}><Avatar name={share.peerName}/><span>{share.peerName || tr('外部联系人')}</span><CaretRight size={14} aria-hidden/></button>
            {share.own && <button type="button" className="arkme-external-icon arkme-external-revoke" disabled={mutating || needsReload} aria-label={tr('取消与 {name} 的共享', {name: share.peerName})} title={tr('取消共享')} onClick={() => {setPending(share); setMutationError('')}}><LinkBreak size={17}/></button>}
          </div>)}</section>)}
          {page?.hasMore && <button type="button" className="arkme-external-more" disabled={loading || mutating} onClick={() => void load(page.nextCursor)}>{tr(loading ? '加载中…' : '加载更多')}</button>}
        </div>
        {pending && <div className="arkme-external-confirm" role="alert"><strong>{tr('取消共享？')}</strong><span>{tr('{name} 的私聊将不再对本团队开放', {name: pending.peerName})}</span>
          {mutationError && <span className="arkme-external-confirm-error">{mutationError}</span>}
          <div><button type="button" disabled={mutating} onClick={() => {if (needsReload) onClose(); else {setPending(undefined); setMutationError('')}}}>{tr(needsReload ? '关闭' : '保留共享')}</button><button type="button" className="is-danger" disabled={mutating || loading} onClick={() => needsReload ? void load() : void unshare()}>{tr(mutating ? '正在取消…' : needsReload ? '重新加载' : '确认取消共享')}</button></div>
        </div>}
      </aside>
      <section className="arkme-external-reader" aria-label={tr('共享消息阅读区')}>
        {selected ? <Reader key={selected.key} share={selected} onBack={() => setSelected(undefined)}/> : !page && loading ? <div className="arkme-external-messages"><Skeleton messages/></div> : <Empty title={tr('选择私聊查看消息')}><span><LockSimple size={14} aria-hidden/>{tr('仅团队成员可读')}</span></Empty>}
      </section>
    </div>
  </TeamFeatureDialog>
}

// Keep media references stable across polling. Host reauthorizes every byte read.
function retainMedia(next: ExternalChatTimeline, previous?: ExternalChatTimeline): ExternalChatTimeline {
  const mediaUrls: Record<string, string> = {}
  const oldItems = new Map(previous?.items.map(item => [item.itemUid, item]))
  const signature = (value: ArkmeTimelineItem) => JSON.stringify(value, (key, v) => key === 'mediaRef' ? undefined : v)
  const items = next.items.map(item => {
    const old = oldItems.get(item.itemUid)
    const stable = old && signature(old) === signature(item) ? old : item
    const blocks = [...stable.contentBlocks ?? [], ...stable.forwardRecords?.items.flatMap(value => [...value.contentBlocks ?? [], ...value.segments?.flatMap(segment => segment.contentBlocks ?? []) ?? []]) ?? []]
    for (const block of blocks) mediaUrls[block.mediaRef] = (stable === old ? previous?.mediaUrls[block.mediaRef] : next.mediaUrls[block.mediaRef]) ?? ''
    return stable
  })
  return {...next, items, mediaUrls}
}
function SharedMessageBody({item, sourceKey}: {item: ArkmeTimelineItem; sourceKey: string}) {
  if (item.forwardRecords) return <div className="arkme-external-forward"><h4>{item.forwardRecords.title}</h4>{item.forwardRecords.items.map((part, index) => <section key={index}>
    <small>{part.senderName}</small>
    <ArkmeMessageContent item={{...part, status: 1, itemUid: `${item.itemUid}:${index}`, isMe: false}} presentation="detail" collapseText={false} sourceIdentityKey={sourceKey} mediaSelectionIsExplicit/>
    {part.segments?.map((segment, position) => <div key={position}><small>{segment.speakerName}</small><ArkmeMessageContent item={{status: 1, itemUid: `${item.itemUid}:${index}:${position}`, senderName: segment.speakerName, sendAtMillis: part.sendAtMillis, title: '', textContent: segment.textContent, contentBlocks: segment.contentBlocks ?? [], isMe: false}} presentation="detail" collapseText={false} sourceIdentityKey={sourceKey} mediaSelectionIsExplicit/></div>)}
  </section>)}</div>
  return <ArkmeMessageContent item={item} presentation="detail" collapseText={false} sourceIdentityKey={sourceKey} mediaSelectionIsExplicit/>
}
interface ScrollPosition {top: number; height: number; bottom: boolean; anchor: string | undefined; offset: number; more: boolean}
function Reader({share, onBack}: {share: ExternalChatShare; onBack(): void}) {
  const [page, setPage] = useState<ExternalChatTimeline>()
  const current = useRef<ExternalChatTimeline>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const retryMore = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const position = useRef<ScrollPosition>()
  const request = useRef<AbortController>()
  const remember = (more: boolean): ScrollPosition | undefined => {
    const node = scroll.current
    if (!node) return undefined
    const anchor = [...node.querySelectorAll<HTMLElement>('[data-message-key]')].find(row => row.getBoundingClientRect().bottom > node.getBoundingClientRect().top)
    return {top: node.scrollTop, height: node.scrollHeight, bottom: node.scrollHeight - node.scrollTop - node.clientHeight < 64, anchor: anchor?.dataset.messageKey, offset: anchor ? anchor.getBoundingClientRect().top - node.getBoundingClientRect().top : 0, more}
  }
  async function load(more = false) {
    if (request.current && !request.current.signal.aborted) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const old = current.current
      const next = await withArkmeReadDeadline(async signal => {
        let next = await callArkme<ExternalChatTimeline>('team.app.external.page', {shareRef: share.ref, ...(more ? {beforeSeq: old?.beforeSeq} : {})}, signal)
        if (more && old) next = {...next, items: [...old.items, ...next.items], mediaUrls: {...old.mediaUrls, ...next.mediaUrls}}
        else while (next.hasMore && next.items.length < (old?.items.length ?? 0)) {
          const older = await callArkme<ExternalChatTimeline>('team.app.external.page', {shareRef: share.ref, beforeSeq: next.beforeSeq}, signal)
          if (older.beforeSeq >= next.beforeSeq || !older.items.length) break
          next = {...older, items: [...next.items, ...older.items], mediaUrls: {...next.mediaUrls, ...older.mediaUrls}}
        }
        return {...next, items: [...new Map(next.items.map(item => [item.itemUid, item])).values()]}
      }, controller.signal)
      if (!controller.signal.aborted) {
        position.current = old ? remember(more) : undefined
        current.current = retainMedia(next, old); setPage(current.current); setError('')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        retryMore.current = more
        if (!transportFailure(error)) {current.current = undefined; setPage(undefined)}
        setError(failure(error))
      }
    } finally {
      if (request.current === controller) request.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  useLayoutEffect(() => {
    const node = scroll.current, previous = position.current
    if (!node || !page) return
    if (!previous || previous.bottom && !previous.more) node.scrollTop = node.scrollHeight
    else {
      const anchor = [...node.querySelectorAll<HTMLElement>('[data-message-key]')].find(row => row.dataset.messageKey === previous.anchor)
      node.scrollTop = anchor ? node.scrollTop + anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - previous.offset
        : previous.more ? previous.top + node.scrollHeight - previous.height : previous.top
    }
    position.current = undefined
  }, [page])
  useEffect(() => {
    void load()
    const refresh = () => {if (document.visibilityState !== 'hidden') void load()}
    const timer = setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    return () => {request.current?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh)}
  }, [share.ref])
  const ordered = [...page?.items ?? []].reverse()
  let day = ''
  return <>
    <header className="arkme-external-reader-heading"><button type="button" className="arkme-external-icon arkme-external-back" aria-label={tr('返回共享私聊列表')} onClick={onBack}><ArrowLeft size={20}/></button><div><strong>{share.sharerName}<span> ↔ </span>{share.peerName}</strong><small><LockSimple size={12} aria-hidden/>{tr('只读')}</small></div><span className="arkme-external-reader-refresh">{busy && page ? <ArrowClockwise size={15} className="is-spinning" aria-label={tr('正在刷新消息')}/> : null}</span></header>
    {error && <ReadError message={error} retry={() => void load(retryMore.current)}/>}
    <div ref={scroll} className="arkme-external-messages" role="log" aria-label={tr('共享消息')} aria-live="off">
      {!page && busy && <Skeleton messages/>}
      {!page && !busy && error && <Empty title={tr('暂时无法查看这段私聊')}/>}
      {page && <ArkmeMediaAccessContext.Provider value={{url: block => page.mediaUrls[block.mediaRef] ?? ''}}>
        {page.hasMore && <button type="button" className="arkme-external-more" disabled={busy} onClick={() => void load(true)}>{tr(busy ? '加载中…' : '查看更早消息')}</button>}
        {!page.items.length && <Empty title={tr('暂无消息')}/>}
        {ordered.map(item => {
          const stamp = item.sendAtMillis > 0 ? new Date(item.sendAtMillis) : undefined
          const date = stamp?.toLocaleDateString(arkmeIntlLocale(), {year: 'numeric', month: 'short', day: 'numeric'}) ?? ''
          const showDay = date !== day; day = date
          const right = item.senderSide === 'sharer'
          return <div key={item.itemUid}>
            {showDay && date && <div className="arkme-external-day">{date}</div>}
            <article className="arkme-external-message" data-side={right ? 'right' : 'left'} data-message-key={item.itemUid} aria-label={item.senderName}>
              <Avatar name={item.senderName} side={right ? 'sharer' : 'peer'}/>
              <div className="arkme-external-message-content"><div className="arkme-external-message-meta"><span>{item.senderName}</span>{stamp && <time dateTime={stamp.toISOString()}>{stamp.toLocaleTimeString(arkmeIntlLocale(), {hour: '2-digit', minute: '2-digit', hour12: false})}</time>}</div><div className="arkme-external-bubble"><SharedMessageBody item={item} sourceKey={share.key}/></div></div>
            </article>
          </div>
        })}
      </ArkmeMediaAccessContext.Provider>}
    </div>
  </>
}
