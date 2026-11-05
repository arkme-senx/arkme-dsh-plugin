import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeOpenPrivateChatResult, ArkmeTeam } from '../types.js'
import type { WorldSubscriptionIncoming, WorldSubscriptionList, WorldSubscriptionNotice, WorldSubscriptionSubject, WorldSubscriptionTarget } from '../world-subscription-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeMemberProfileCard } from './ArkmeMemberProfileCard.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { conversationWindowRequested, navigateConversationWindow } from './conversation-window.js'
import { openTeamOutbound } from './team-outbound.js'
import { tr } from './locale.js'

export function worldSubscriptionAccount(): string {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
}
const changed = 'arkme-world-subscriptions-changed'
const errorText = (e: unknown) => e instanceof Error ? e.message : tr('订阅暂时不可用，请重试')
const small: CSSProperties = { border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 8, padding: '7px 12px', background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit', fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer' }

export function WorldSubscribeButton({ target, initialSubscribed }: { target: WorldSubscriptionTarget | WorldSubscriptionSubject; initialSubscribed?: boolean | undefined }) {
  const account = useSyncExternalStore(arkmeAuthStore.subscribe, worldSubscriptionAccount, () => '')
  return account ? <ScopedSubscribeButton key={`${account}:${JSON.stringify(target)}`} account={account} target={target} initialSubscribed={initialSubscribed} /> : null
}
function ScopedSubscribeButton({ account, target, initialSubscribed }: { account: string; target: WorldSubscriptionTarget | WorldSubscriptionSubject; initialSubscribed?: boolean | undefined }) {
  const [active, setActive] = useState<boolean | undefined>(initialSubscribed), [busy, setBusy] = useState(false), [error, setError] = useState(''), [more, setMore] = useState(false), [revision, setRevision] = useState(0)
  const readEpoch = useRef(0)
  const pending = useRef<AbortController>(), command = useRef<{ active: boolean; uid: string }>()
  const self = target.kind === 'person' && String('id' in target ? target.id : target.userId) === account.split(':').at(-1)
  useEffect(() => {
    const refresh = () => { if (initialSubscribed === undefined && !pending.current) setRevision(v => v + 1) }
    window.addEventListener(changed, refresh)
    return () => { window.removeEventListener(changed, refresh); pending.current?.abort() }
  }, [])
  useEffect(() => {
    if (self || initialSubscribed !== undefined && revision === 0) return
    const epoch = readEpoch.current, controller = new AbortController()
    void callArkme<{ subscribed: boolean }>('world.subscriptions', { accountKey: account, action: 'state', target }, controller.signal).then(v => {
      if (!controller.signal.aborted && epoch === readEpoch.current && account === worldSubscriptionAccount()) { setActive(v.subscribed); setError('') }
    }).catch(e => { if (!controller.signal.aborted && epoch === readEpoch.current && account === worldSubscriptionAccount()) setError(errorText(e)) })
    return () => controller.abort()
  }, [revision])
  const change = async (next: boolean) => {
    if (pending.current || account !== worldSubscriptionAccount()) return
    readEpoch.current++
    const controller = new AbortController(); pending.current = controller; setBusy(true); setMore(false); setError('')
    if (command.current?.active !== next) command.current = { active: next, uid: crypto.randomUUID() }
    try {
      const value = await callArkme<{ subscribed: boolean }>('world.subscriptions', { accountKey: account, action: 'set', target, active: next, requestUid: command.current.uid }, controller.signal)
      if (controller.signal.aborted || account !== worldSubscriptionAccount()) return
      setActive(value.subscribed); command.current = undefined; window.dispatchEvent(new Event(changed))
    } catch (e) { if (!controller.signal.aborted && account === worldSubscriptionAccount()) setError(errorText(e)) }
    finally { if (pending.current === controller) { pending.current = undefined; if (!controller.signal.aborted) setBusy(false) } }
  }
  if (self) return null
  return <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }} data-world-subscribe>
    {active ? <ArkmeActionMenu open={more} label={tr('订阅操作')} onClose={() => setMore(false)} align="end" anchor={<button type="button" style={small} aria-expanded={more} disabled={busy} onClick={() => setMore(v => !v)}>{tr(busy ? '处理中…' : '已订阅 ▾')}</button>} actions={[{ id: 'unsubscribe', label: tr('取消订阅'), onSelect: () => { void change(false) } }]} />
      : <button type="button" style={small} disabled={busy || active === undefined} onClick={() => { void change(true) }}>{tr(busy ? '处理中…' : active === undefined ? '读取订阅…' : '＋订阅')}</button>}
    {error && <small role="alert" style={{ color: arkmeTheme.secondary }}>{error} <button type="button" style={small} disabled={busy} onClick={() => command.current ? void change(command.current.active) : setRevision(v => v + 1)}>{tr('重试')}</button></small>}
  </span>
}

export function WorldSubscriptionEntry() {
  const account = useSyncExternalStore(arkmeAuthStore.subscribe, worldSubscriptionAccount, () => ''), [open, setOpen] = useState(false)
  return account ? <><button type="button" style={small} onClick={() => setOpen(true)}>{tr('订阅管理')}</button>{open && <WorldSubscriptionManager key={account} account={account} onClose={() => setOpen(false)} />}</> : null
}

export function WorldSubscriptionManager(props: { account: string; onClose(): void; initialTeam?: string | undefined; initialIncoming?: boolean }) {
  const panel = <ScopedSubscriptionManager {...props} />
  return typeof document === 'undefined' ? panel : createPortal(panel, document.body)
}
function ScopedSubscriptionManager({ account, onClose, initialTeam, initialIncoming = false }: { account: string; onClose(): void; initialTeam?: string | undefined; initialIncoming?: boolean }) {
  const [tab, setTab] = useState<'outgoing' | 'incoming'>(initialTeam || initialIncoming ? 'incoming' : 'outgoing'), [team, setTeam] = useState(initialTeam ?? ''), [teams, setTeams] = useState<ArkmeTeam[]>([]), [teamError, setTeamError] = useState('')
  const [page, setPage] = useState<WorldSubscriptionList>(), [windowed, setWindowed] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [person, setPerson] = useState<{ userId: number; name: string }>()
  const pending = useRef<AbortController>(), current = useRef('')
  const incoming: WorldSubscriptionIncoming | undefined = tab === 'outgoing' ? undefined : team ? { kind: 'team', teamRef: teams.find(t => t.jotmoId === team)?.teamRef ?? '' } : { kind: 'self' }
  const scope = JSON.stringify([account, tab, incoming]); current.current = scope
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeTeam[]>('team.app.teams', { expectedAccountKey: account }, controller.signal).then(v => { if (!controller.signal.aborted && account === worldSubscriptionAccount()) setTeams(v.filter(t => t.currentUserRole === 'owner' || t.currentUserRole === 'admin')) }).catch(e => { if (!controller.signal.aborted) setTeamError(errorText(e)) })
    return () => controller.abort()
  }, [account, revision])
  const load = async (more = false) => {
    if (account !== worldSubscriptionAccount() || tab === 'incoming' && team && !teams.some(t => t.jotmoId === team)) return
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller; const issued = scope
    setBusy(true); setError('')
    try {
      const value = await callArkme<WorldSubscriptionList>('world.subscriptions', { accountKey: account, action: 'query', ...(incoming ? { incoming } : {}), ...(more && page?.nextCursor ? { cursor: page.nextCursor } : {}) }, controller.signal)
      if (!controller.signal.aborted && current.current === issued && account === worldSubscriptionAccount()) {
        const rows = more ? [...(page?.items ?? []), ...value.items].filter((r, i, all) => all.findIndex(x => `${x.subject.kind}:${x.subject.id}:${x.subscriber.userId}` === `${r.subject.kind}:${r.subject.id}:${r.subscriber.userId}`) === i) : value.items
        setWindowed(more && (windowed || rows.length > 300)); setPage({ ...value, items: rows.slice(-300) })
      }
    } catch (e) { if (!controller.signal.aborted && current.current === issued) { setError(errorText(e)); if (!more) setPage(undefined) } }
    finally { if (pending.current === controller && !controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => { setPage(undefined); void load(); return () => pending.current?.abort() }, [scope, revision])
  useEffect(() => { const refresh = () => setRevision(v => v + 1); window.addEventListener(changed, refresh); return () => window.removeEventListener(changed, refresh) }, [])
  if (account !== worldSubscriptionAccount()) return null
  return <ArkmeDetailShell title={tr('订阅管理')} label={tr('订阅管理')} onClose={onClose} widthPreferenceKey="arkme.world-subscriptions.width" style={{ position: 'fixed', top: 0, zIndex: 25 }}>
    <button type="button" style={{...small,marginBottom:12}} disabled={busy} onClick={() => setRevision(v => v + 1)}>{tr('刷新订阅')}</button>
    <nav aria-label={tr('订阅范围')} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" style={{ ...small, ...(tab === 'outgoing' ? { background: arkmeTheme.accentSoft, color: arkmeTheme.accent } : {}) }} aria-pressed={tab === 'outgoing'} onClick={() => setTab('outgoing')}>{tr('我订阅的')}</button><button type="button" style={{ ...small, ...(tab === 'incoming' ? { background: arkmeTheme.accentSoft, color: arkmeTheme.accent } : {}) }} aria-pressed={tab === 'incoming'} onClick={() => setTab('incoming')}>{tr('订阅我的')}</button></nav>
    {tab === 'incoming' && <label style={{ display: 'block', marginTop: 16 }}>{tr('查看身份')} <select style={{ ...small, display: 'block', width: '100%', marginTop: 8, boxSizing: 'border-box', textOverflow: 'ellipsis' }} aria-label={tr('查看订阅者的身份')} value={team} onChange={e => setTeam(e.currentTarget.value)}><option value="">{tr('我自己')}</option>{teams.map(t => <option key={t.jotmoId} value={t.jotmoId}>{t.name}</option>)}</select></label>}
    {windowed && <p role="status" style={{color:arkmeTheme.secondary}}>{tr('当前显示最近加载的 300 条，刷新可返回列表开头')}</p>}
    {teamError && <p role="alert">{tr('团队身份暂时无法加载')} <button type="button" style={small} onClick={() => { setTeamError(''); setRevision(v => v + 1) }}>{tr('重试')}</button></p>}
    {error && <p role="alert">{error} <button type="button" style={small} onClick={() => void load()}>{tr('重试')}</button></p>}
    {busy && <p role="status">{tr('正在加载订阅…')}</p>}
    {page && !page.items.length && <p style={{ color: arkmeTheme.secondary }}>{tr(tab === 'outgoing' ? '还没有订阅，去感兴趣的个人或团队世界看看吧' : '暂时还没有订阅者')}</p>}
    <div role="list" aria-label={tr(tab === 'outgoing' ? '我订阅的' : '订阅者')} style={{ marginTop: 16 }}>
      {page?.items.map(r => <div role="listitem" key={`${r.subject.kind}:${r.subject.id}:${r.subscriber.userId}`} style={{ padding: '14px 0', borderBottom: `1px solid ${arkmeTheme.borderSoft}`, display: 'grid', gap: 9 }}>
        {tab === 'outgoing' ? <><button type="button" style={{ ...small, textAlign: 'left', border: 0 }} disabled={!r.subject.available} onClick={() => { if (r.subject.kind === 'person' && r.subject.userId) { onClose(); arkmeUi.showUserWorld({ userId: r.subject.userId, displayName: r.subject.name }) } else if (r.subject.jotmoId) { onClose(); arkmeUi.showTeamWorld({ jotmoId: r.subject.jotmoId, name: r.subject.name }) } }}>{r.subject.name} · {tr(r.subject.kind === 'team' ? '团队' : '个人')}</button><WorldSubscribeButton target={r.subject} initialSubscribed /></>
          : <><button type="button" style={{ ...small, textAlign: 'left', border: 0 }} onClick={() => setPerson(r.subscriber)}>{r.subscriber.name}</button><WorldSubscriberContact account={account} person={r.subscriber} teamJotmoId={team || undefined} onOpened={onClose} /></>}
      </div>)}
    </div>
    {page?.hasMore && <button type="button" style={small} disabled={busy} onClick={() => void load(true)}>{tr('加载更多订阅')}</button>}
    {person && <ArkmeMemberProfileCard member={{ displayName: person.name }} copyLinkTarget={{ kind: 'person', userId: person.userId }} busy={false} onClose={() => setPerson(undefined)} onSend={() => { setPerson(undefined) }} hideSend />}
  </ArkmeDetailShell>
}

export function WorldSubscriberContact({ account, person, teamJotmoId, onOpened }: { account: string; person: { userId: number; name: string }; teamJotmoId?: string | undefined; onOpened?(): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const pending = useRef<AbortController>()
  useEffect(() => () => pending.current?.abort(), [account, person.userId, teamJotmoId])
  const open = async () => {
    if (pending.current || account !== worldSubscriptionAccount()) return
    if (teamJotmoId) { openTeamOutbound({ accountKey: account, teamJotmoId, person: { recipient: { kind: 'public-person', userId: person.userId }, displayName: person.name } }); onOpened?.(); return }
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('')
    try { const value = await callArkme<ArkmeOpenPrivateChatResult>('world.subscriptions', { accountKey: account, action: 'contact', userId: person.userId, displayName: person.name }, controller.signal); if (!controller.signal.aborted && account === worldSubscriptionAccount()) { if (conversationWindowRequested()) await navigateConversationWindow(value.source); else { arkmeChatDirectory.upsert(value.source); arkmeUi.selectSource(value.source) }; onOpened?.() } }
    catch (e) { if (!controller.signal.aborted) setError(errorText(e)) }
    finally { if (pending.current === controller) { pending.current = undefined; if (!controller.signal.aborted) setBusy(false) } }
  }
  return <span><button type="button" style={small} disabled={busy} onClick={() => void open()}>{tr(busy ? '正在打开…' : teamJotmoId ? '以团队联系' : '私聊')}</button>{error && <small role="alert">{error}</small>}</span>
}

export function WorldSubscriberNoticeActions({ notice, account }: { notice: WorldSubscriptionNotice; account: string }) {
  const [open,setOpen]=useState(false)
  const team=notice.subject.kind==='team'
  if (team&&!notice.subject.jotmoId) return <small>{tr('团队暂不可用')}</small>
  return <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}><WorldSubscriberContact account={account} person={notice.actor} teamJotmoId={team?notice.subject.jotmoId:undefined} /><button type="button" style={small} onClick={()=>setOpen(true)}>{tr('订阅者名单')}</button>{open&&<WorldSubscriptionManager account={account} initialIncoming initialTeam={team?notice.subject.jotmoId:undefined} onClose={()=>setOpen(false)} />}</div>
}

