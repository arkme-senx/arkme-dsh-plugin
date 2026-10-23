import { useEffect, useRef, useState } from 'react'
import type { ArkmeTeam, ArkmeTimelineItem } from '../types.js'
import type { ExternalChatDirectory, ExternalChatShare, ExternalChatTimeline } from '../team-external-chat-contract.js'
import { callArkme } from './api.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMediaAccessContext } from './media-access.js'

const failure = (error: unknown) => error instanceof Error ? error.message : '加载失败，请重试'
const disclosure = '选择团队后，全体现任成员可只读查看这段私聊的完整历史和后续消息，包括隐私锁定消息及附件。取消共享后停止团队访问。'

// Reuse unchanged media references so polling does not restart playback. Each
// reference is still reauthorized by the Host whenever it serves media bytes.
function retainMedia(next: ExternalChatTimeline, previous?: ExternalChatTimeline): ExternalChatTimeline {
  const mediaUrls: Record<string, string> = {}
  const items = next.items.map(item => {
    const old = previous?.items.find(value => value.itemUid === item.itemUid)
    const signature = (value: typeof item) => JSON.stringify(value, (key, v) => key === 'mediaRef' ? undefined : v)
    const stable = old && signature(old) === signature(item) ? old : item
    const blocks = [...stable.contentBlocks ?? [], ...stable.forwardRecords?.items.flatMap(value => [...value.contentBlocks ?? [], ...value.segments?.flatMap(segment => segment.contentBlocks ?? []) ?? []]) ?? []]
    for (const block of blocks) mediaUrls[block.mediaRef] = (stable === old ? previous?.mediaUrls[block.mediaRef] : next.mediaUrls[block.mediaRef]) ?? ''
    return stable
  })
  return { ...next, items, mediaUrls }
}

function SharedMessageBody({item, sourceKey}: {item: ArkmeTimelineItem; sourceKey: string}) {
  if (item.forwardRecords) return <div><h4>{item.forwardRecords.title}</h4>{item.forwardRecords.items.map((part, index) => <section key={index}>
    <small>{part.senderName}</small>
    <ArkmeMessageContent item={{...part, status: 1, itemUid: `${item.itemUid}:${index}`, isMe: false}} presentation="detail" collapseText={false} sourceIdentityKey={sourceKey} mediaSelectionIsExplicit/>
    {part.segments?.map((segment, position) => <div key={position}><small>{segment.speakerName}</small><ArkmeMessageContent item={{status: 1, itemUid: `${item.itemUid}:${index}:${position}`, senderName: segment.speakerName, sendAtMillis: part.sendAtMillis, title: '', textContent: segment.textContent, contentBlocks: segment.contentBlocks ?? [], isMe: false}} presentation="detail" collapseText={false} sourceIdentityKey={sourceKey} mediaSelectionIsExplicit/></div>)}
  </section>)}</div>
  return <ArkmeMessageContent item={item} presentation="detail" collapseText={false} sourceIdentityKey={sourceKey} mediaSelectionIsExplicit/>
}

export function TeamExternalChats(props: {teamRef: string; teamName: string; onClose(): void}) {
  return <ScopedDirectory key={props.teamRef} {...props}/>
}
function ScopedDirectory({teamRef, teamName, onClose}: {teamRef: string; teamName: string; onClose(): void}) {
  const [page, setPage] = useState<ExternalChatDirectory>()
  const [selected, setSelected] = useState<ExternalChatShare>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController>()
  async function load(cursor?: string) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    try {
      const next = await callArkme<ExternalChatDirectory>('team.app.external.list', {teamRef, ...(cursor ? {cursor} : {})}, controller.signal)
      if (!controller.signal.aborted) setPage(old => cursor && old ? {...next, items: [...old.items, ...next.items]} : next)
    } catch (error) {
      if (!controller.signal.aborted) { setError(failure(error)); setPage(undefined) }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => { void load(); return () => request.current?.abort() }, [teamRef])
  async function unshare(share: ExternalChatShare) {
    if (busy) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    try {
      await callArkme('team.app.external.unshare', {shareRef: share.ref}, controller.signal)
      if (!controller.signal.aborted) setPage(old => old ? {...old, items: old.items.filter(value => value.key !== share.key)} : old)
    } catch (error) { if (!controller.signal.aborted) setError(failure(error)) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const groups = new Map<string, ExternalChatShare[]>()
  for (const share of page?.items ?? []) groups.set(share.sharerKey, [...(groups.get(share.sharerKey) ?? []), share])
  return <TeamFeatureDialog className="arkme-team-external-dialog" title="对外私聊" teamName={teamName} onClose={onClose}>
    {selected ? <ExternalChatReader key={selected.key} share={selected} onBack={() => {setSelected(undefined); void load()}}/> : <>
      <p>成员主动共享的个人私聊，仅供团队成员查看。</p>
      {error && <p role="alert">{error} <button onClick={() => void load()}>重试</button></p>}
      {busy && <p role="status">加载中…</p>}
      {page && !page.items.length && <p>暂无对外私聊。可以在个人私聊的更多菜单中共享到本团队。</p>}
      {[...groups].map(([key, shares]) => <section key={key}><h3>{shares[0]?.sharerName}</h3>{shares.map(share => <div key={share.key} className="arkme-team-external-row">
        <button className="arkme-team-external-peer" onClick={() => setSelected(share)}>{share.peerName} ›</button>
        {share.own && <button disabled={busy} onClick={() => void unshare(share)}>取消共享</button>}
      </div>)}</section>)}
      {page?.hasMore && <button disabled={busy} onClick={() => void load(page.nextCursor)}>加载更多</button>}
    </>}
  </TeamFeatureDialog>
}
function ExternalChatReader({share, onBack}: {share: ExternalChatShare; onBack(): void}) {
  const [page, setPage] = useState<ExternalChatTimeline>()
  const current = useRef<ExternalChatTimeline>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController>()
  async function load(more = false) {
    if (request.current && !request.current.signal.aborted) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const old = current.current
      let next = await callArkme<ExternalChatTimeline>('team.app.external.page', {shareRef: share.ref, ...(more ? {beforeSeq: old?.beforeSeq} : {})}, controller.signal)
      // Refresh the loaded window, including older pages, so removed messages
      // disappear. Never append old content that the server no longer returns.
      if (more && old) next = {...next, items: [...old.items, ...next.items], mediaUrls: {...old.mediaUrls, ...next.mediaUrls}}
      else while (next.hasMore && next.items.length < (old?.items.length ?? 0)) {
        const older = await callArkme<ExternalChatTimeline>('team.app.external.page', {shareRef: share.ref, beforeSeq: next.beforeSeq}, controller.signal)
        if (older.beforeSeq === next.beforeSeq) break
        next = {...older, items: [...next.items, ...older.items], mediaUrls: {...next.mediaUrls, ...older.mediaUrls}}
      }
      if (!controller.signal.aborted) { current.current = retainMedia(next, old); setPage(current.current); setError('') }
    } catch (error) {
      if (!controller.signal.aborted) { current.current = undefined; setPage(undefined); setError(failure(error)) }
    } finally {
      if (request.current === controller) request.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    const refresh = () => { if (document.visibilityState !== 'hidden') void load() }
    const timer = setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    return () => {request.current?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh)}
  }, [share.ref])
  return <div><button onClick={onBack}>‹ 返回列表</button><h3>{share.sharerName} 与 {share.peerName}</h3><p>团队共享 · 只读</p>
    {error && <p role="alert">{error} <button onClick={() => void load()}>重试</button></p>}
    {!page && !error && <p role="status">加载中…</p>}
    {page && <ArkmeMediaAccessContext.Provider value={{url: block => page.mediaUrls[block.mediaRef] ?? ''}}>
      {page.hasMore && <button disabled={busy} onClick={() => void load(true)}>查看更早消息</button>}
      {!page.items.length && <p>暂无消息</p>}
      {[...page.items].reverse().map(item => <article key={item.itemUid} className="arkme-team-external-message"><small>{item.senderName} · {new Date(item.sendAtMillis).toLocaleString()}</small><SharedMessageBody item={item} sourceKey={share.key}/></article>)}
    </ArkmeMediaAccessContext.Provider>}
  </div>
}
export function SharePrivateChat(props: {sourceRef: string; name: string; onClose(): void}) {
  return <ScopedSharePrivateChat key={props.sourceRef} {...props}/>
}
function ScopedSharePrivateChat({sourceRef, name, onClose}: {sourceRef: string; name: string; onClose(): void}) {
  const [teams, setTeams] = useState<ArkmeTeam[]>([])
  const [shares, setShares] = useState<ExternalChatShare[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const request = useRef<AbortController>()
  async function load() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    try {
      const [teams, shares] = await Promise.all([callArkme<ArkmeTeam[]>('team.app.teams', {}, controller.signal), callArkme<ExternalChatDirectory>('team.app.external.mine', {sourceRef}, controller.signal)])
      if (!controller.signal.aborted) {setTeams(teams); setShares(shares.items)}
    } catch (error) {if (!controller.signal.aborted) setError(failure(error))}
    finally {if (!controller.signal.aborted) setBusy(false)}
  }
  useEffect(() => {void load(); return () => request.current?.abort()}, [sourceRef])
  async function toggle(team: ArkmeTeam) {
    if (busy) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    const existing = shares.find(value => value.teamKey === team.key)
    try {
      if (existing) {
        await callArkme('team.app.external.unshare', {shareRef: existing.ref}, controller.signal)
        if (!controller.signal.aborted) setShares(values => values.filter(value => value.key !== existing.key))
      } else {
        const next = await callArkme<ExternalChatDirectory>('team.app.external.share', {teamRef: team.teamRef, sourceRef}, controller.signal)
        if (!controller.signal.aborted) setShares(values => [...values, ...next.items])
      }
    } catch (error) {if (!controller.signal.aborted) setError(failure(error))}
    finally {if (!controller.signal.aborted) setBusy(false)}
  }
  return <TeamFeatureDialog className="arkme-team-external-dialog" title="共享为对外私聊" teamName={name} onClose={onClose}>
    <p>{disclosure}</p>
    {error && <p role="alert">{error} <button onClick={() => void load()}>重试</button></p>}
    {busy && <p role="status">处理中…</p>}
    {!busy && !error && !teams.length && <p>你尚未加入团队</p>}
    {teams.map(team => <label key={team.key ?? team.teamRef} className="arkme-team-external-row"><input type="checkbox" disabled={busy} checked={shares.some(value => value.teamKey === team.key)} onChange={() => void toggle(team)}/>{team.name}</label>)}
  </TeamFeatureDialog>
}
