import { useEffect, useRef, useState } from 'react'
import type { ArkmeTeam, ArkmeTimelineItem } from '../types.js'
import type { ExternalChatDirectory, ExternalChatShare, ExternalChatTimeline } from '../team-external-chat-contract.js'
import { callArkme } from './api.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMediaAccessContext } from './media-access.js'
import { tr, useArkmeLocale } from './locale.js'

const failure = (error: unknown) => error instanceof Error ? error.message : '加载失败，请重试'
const teamKey = (team: ArkmeTeam) => team.key ?? team.teamRef
const sharedWith = (share: ExternalChatShare, team: ArkmeTeam) => team.key ? share.teamKey === team.key : share.teamRef === team.teamRef

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
  useArkmeLocale()
  const [teams, setTeams] = useState<ArkmeTeam[]>([])
  const [shares, setShares] = useState<ExternalChatShare[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const [error, setError] = useState('')
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const request = useRef<AbortController>()
  const savingRef = useRef(false)
  async function load() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setReady(false); setError('')
    try {
      const [teams, shares] = await Promise.all([callArkme<ArkmeTeam[]>('team.app.teams', {}, controller.signal), callArkme<ExternalChatDirectory>('team.app.external.mine', {sourceRef}, controller.signal)])
      if (!controller.signal.aborted) {
        setTeams(teams); setShares(shares.items)
        setSelected(new Set(teams.filter(team => shares.items.some(share => sharedWith(share, team))).map(teamKey)))
        setReady(true)
      }
    } catch (error) {if (!controller.signal.aborted) setError(failure(error))}
    finally {if (!controller.signal.aborted) setLoading(false)}
  }
  useEffect(() => {void load(); return () => request.current?.abort()}, [sourceRef])
  const changes = teams.filter(team => selected.has(teamKey(team)) !== shares.some(share => sharedWith(share, team)))
  const additions = changes.filter(team => selected.has(teamKey(team))).length
  async function save() {
    if (savingRef.current || !ready || !changes.length) return
    savingRef.current = true
    const controller = new AbortController()
    request.current = controller
    setSaving(true); setSaved(false); setSaveErrors({})
    const failures: Record<string, string> = {}
    try {
      for (const team of changes) {
        if (controller.signal.aborted) return
        const existing = shares.find(share => sharedWith(share, team))
        try {
          if (existing) {
            await callArkme('team.app.external.unshare', {shareRef: existing.ref}, controller.signal)
            if (!controller.signal.aborted) setShares(values => values.filter(value => value.key !== existing.key))
          } else {
            const next = await callArkme<ExternalChatDirectory>('team.app.external.share', {teamRef: team.teamRef, sourceRef}, controller.signal)
            if (!controller.signal.aborted) setShares(values => [...values.filter(share => !sharedWith(share, team)), ...next.items])
          }
          if (!controller.signal.aborted) setHasSaved(true)
        } catch (error) {
          if (controller.signal.aborted) return
          failures[teamKey(team)] = failure(error)
        }
      }
      if (!controller.signal.aborted) {setSaveErrors(failures); setSaved(Object.keys(failures).length === 0)}
    } finally {
      savingRef.current = false
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  const failed = Object.keys(saveErrors).length > 0
  return <TeamFeatureDialog className="arkme-team-external-dialog arkme-private-chat-share-dialog" title={tr('共享到团队')} teamName={name} onClose={onClose} busy={saving}
    footer={<>
      <span className="arkme-private-chat-share-summary" role="status">{saving ? tr('正在保存…') : saved ? tr('共享设置已更新') : ready ? tr('已共享到 {count} 个团队', {count: shares.length}) : ''}</span>
      {!saved && <button type="button" className="arkme-contact-remark-cancel" disabled={saving} onClick={onClose}>{tr(hasSaved ? '关闭' : '取消')}</button>}
      <button type="button" className="arkme-contact-remark-confirm" disabled={saving || (!saved && (!ready || !changes.length))} onClick={() => saved ? onClose() : void save()}>
        {tr(saving ? '保存中…' : saved ? '完成' : failed ? '重试保存' : additions ? '确认共享' : '保存更改')}
      </button>
    </>}>
    <p className="arkme-private-chat-share-disclosure">{tr('团队成员可只读查看全部历史和新消息。')}</p>
    {error && <p className="arkme-private-chat-share-error" role="alert">{error} <button type="button" onClick={() => void load()}>{tr('重试')}</button></p>}
    {loading && <p className="arkme-private-chat-share-empty" role="status">{tr('正在加载团队…')}</p>}
    {ready && !teams.length && <p className="arkme-private-chat-share-empty">{tr('你尚未加入团队')}</p>}
    {ready && teams.length > 0 && <fieldset className="arkme-private-chat-share-teams" disabled={saving}>
      <legend>{tr('选择团队')}</legend>
      {teams.map(team => {
        const key = teamKey(team), checked = selected.has(key), shared = shares.some(share => sharedWith(share, team))
        return <label key={key} className="arkme-private-chat-share-team" data-selected={checked}>
          <input type="checkbox" checked={checked} onChange={() => {
            if (savingRef.current) return
            setSelected(values => {const next = new Set(values); if (next.has(key)) next.delete(key); else next.add(key); return next})
            setSaved(false); setSaveErrors({})
          }}/>
          <span className="arkme-private-chat-share-avatar" aria-hidden="true">{[...team.name][0]}</span>
          <span className="arkme-private-chat-share-name">{team.name}</span>
          <span className="arkme-private-chat-share-state">{tr(checked ? shared ? '已共享' : '待共享' : shared ? '待取消' : '未共享')}</span>
        </label>
      })}
    </fieldset>}
    {failed && <div className="arkme-private-chat-share-error" role="alert">
      <p>{tr(hasSaved ? '部分更改已保存，请重试未成功的团队。' : '未能保存更改，请重试。')}</p>
      {teams.filter(team => saveErrors[teamKey(team)]).map(team => <p key={teamKey(team)}>{team.name}：{saveErrors[teamKey(team)]}</p>)}
    </div>}
  </TeamFeatureDialog>
}
