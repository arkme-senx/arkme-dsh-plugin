import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { callArkme } from './api.js'
import { createArkmeSdk } from '../sdk/index.js'
import type { ArkmeTeam, ArkmeUploadedAsset } from '../types.js'
import type { TeamApplication, TeamChannel, TeamContent, TeamConversation, TeamIdentity, TeamMembers, TeamMessage, TeamOpen, TeamPage, TeamReceipts, TeamSendResult, TeamTimeline } from '../team-app-contract.js'
import { openTeamMessages, subscribeTeamMessageChanges, subscribeTeamMessageOpen, type TeamMessageIntent } from './team-messaging-events.js'
import { loadTeamDraft, persistTeamDraft, type TeamDraft as Draft } from './team-message-draft.js'
import { hasUnreadTeamMessages } from './team-message-unread.js'
import { TeamMessageAttachment } from './TeamMessageAttachment.js'

function errorText(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请重试' }
function inaccessible(error: unknown): boolean { return /team-(not_accessible|account-changed)|login-/.test(String((error as { body?: { code?: string } })?.body?.code)) }

export function TeamAvatar({ identity, team }: { identity: TeamIdentity; team?: TeamIdentity }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    setUrl(''); if (!identity.imageRef) return
    const controller = new AbortController()
    void callArkme<{ base64: string; mimeType: string }>('team.app.image', { imageRef: identity.imageRef }, controller.signal)
      .then(v => { if (!controller.signal.aborted) setUrl(`data:${v.mimeType};base64,${v.base64}`) }).catch(() => {})
    return () => { controller.abort() }
  }, [identity.imageRef])
  return <span className="team-avatar" title={identity.nickname}>
    {url ? <img src={url} alt={identity.nickname} /> : <span>{identity.nickname.slice(0, 1)}</span>}
    {team && <span className="team-avatar-badge"><TeamAvatar identity={team} /></span>}
  </span>
}

export function TeamMessagingMount({ accountKey, active }: { accountKey: string; active: boolean }) {
  const [intent, setIntent] = useState<TeamMessageIntent>()
  useEffect(() => { setIntent(undefined); return subscribeTeamMessageOpen(setIntent) }, [accountKey])
  return active && intent ? createPortal(<TeamMessagingPanel key={accountKey} accountKey={accountKey} intent={intent} onClose={() => { setIntent(undefined) }} />, document.body) : null
}

export function TeamMessagingEntry({ accountKey }: { accountKey: string }) {
  const [unread, setUnread] = useState(false)
  useEffect(() => {
    setUnread(false)
    let controller = new AbortController()
    const refresh = () => {
      controller.abort(); controller = new AbortController()
      const signal = controller.signal
      void hasUnreadTeamMessages((side, cursor) => callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side, cursor, limit: 100 }, signal), signal)
        .then(value => { if (!signal.aborted) setUnread(value) }).catch(() => {})
    }
    refresh()
    const unsubscribe = subscribeTeamMessageChanges(account => { if (account === accountKey) refresh() })
    return () => { controller.abort(); unsubscribe() }
  }, [accountKey])
  return <button type="button" className="team-message-entry" onClick={() => { openTeamMessages({ kind: 'inbox' }) }}><span>团队消息</span>{unread && <span aria-label="有未读消息" className="team-unread-dot" />}</button>
}

function TeamMessagingPanel({ accountKey, intent, onClose }: { accountKey: string; intent: TeamMessageIntent; onClose(): void }) {
  const [teams, setTeams] = useState<ArkmeTeam[]>([])
  const [side, setSide] = useState<'team' | 'external'>('team')
  const [page, setPage] = useState<TeamPage<TeamConversation>>({ items: [], hasMore: false })
  const [selected, setSelected] = useState<TeamConversation>()
  const [settings, setSettings] = useState<string>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [joinId, setJoinId] = useState('')
  const [teamName, setTeamName] = useState('')
  const [newTeamId, setNewTeamId] = useState('')
  const [link, setLink] = useState('')
  const [membershipResult, setMembershipResult] = useState('')
  const [membershipBusy, setMembershipBusy] = useState(false)
  const joinUid = useRef(crypto.randomUUID()), createUid = useRef(crypto.randomUUID())
  const controller = useRef(new AbortController()), listGeneration = useRef(0), dialog = useRef<HTMLDivElement>(null)
  const listSide = useRef(side); listSide.current = side
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => { controller.current.abort(); previous?.focus() } }, [])
  const refreshTeams = useCallback(async () => {
    const result = await callArkme<ArkmeTeam[]>('team.app.teams', {}, controller.current.signal)
    if (!controller.current.signal.aborted) setTeams(result)
  }, [])
  const refresh = useCallback(async (cursor?: string) => {
    const generation = ++listGeneration.current, requestedSide = listSide.current
    setLoading(true)
    try {
      const next = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { side: requestedSide, ...(cursor ? { cursor } : {}) }, controller.current.signal)
      if (controller.current.signal.aborted || generation !== listGeneration.current) return
      setPage(old => ({ ...next, items: cursor ? [...new Map([...old.items, ...next.items].map(v => [v.key, v])).values()] : next.items }))
      setError('')
    } catch (e) { if (!controller.current.signal.aborted && generation === listGeneration.current) { setError(errorText(e)); if (inaccessible(e)) { setPage({ items: [], hasMore: false }); setSelected(undefined) } } }
    finally { if (!controller.current.signal.aborted && generation === listGeneration.current) setLoading(false) }
  }, [])
  const open = useCallback(async (ref: string) => {
    const data = await callArkme<TeamOpen>('team.app.open', { publicRef: ref }, controller.current.signal)
    if (controller.current.signal.aborted) return
    if (data.openInbox) { setSide('team'); setSettings(data.channel.teamRef); setSelected(undefined) }
    else if (data.conversation) { setSide('external'); setSelected(data.conversation); setSettings(undefined) }
  }, [])
  useEffect(() => { void refresh(); void refreshTeams().catch(e => { if (!controller.current.signal.aborted) setError(errorText(e)) }) }, [side, refresh, refreshTeams])
  useEffect(() => {
    const run = async () => {
      if (intent.kind === 'official') { const channel = await callArkme<TeamChannel>('team.app.official', {}, controller.current.signal); await open(channel.publicRef) }
      else if (intent.kind === 'link') await open(intent.publicRef)
      else if (intent.kind === 'team') { setSettings(intent.teamRef); setSelected(undefined) }
    }
    void run().catch(e => { if (!controller.current.signal.aborted) setError(errorText(e)) })
  }, [intent, open])
  useEffect(() => subscribeTeamMessageChanges(account => {
    if (account === accountKey) { void refresh(); void refreshTeams().catch(() => {}) }
  }), [accountKey, refresh, refreshTeams])
  const membership = async (kind: 'join' | 'create') => {
    setMembershipBusy(true); setMembershipResult('')
    try {
      if (kind === 'join') { const result = await callArkme<{ state: string }>('team.app.join', { jotmoId: joinId.trim(), requestUid: joinUid.current }, controller.current.signal); setMembershipResult(result.state === 'pending' ? '申请已提交，等待团队所有者审批' : '已加入团队'); joinUid.current = crypto.randomUUID() }
      else { const team = await callArkme<ArkmeTeam>('team.app.create', { name: teamName.trim(), jotmoId: newTeamId.trim(), requestUid: createUid.current }, controller.current.signal); createUid.current = crypto.randomUUID(); setSettings(team.teamRef); setTeamName(''); setNewTeamId('') }
      await refreshTeams()
    } catch (e) { if (!controller.current.signal.aborted) setError(errorText(e)) }
    finally { if (!controller.current.signal.aborted) setMembershipBusy(false) }
  }
  return <div className="team-message-backdrop" data-arkme-notification-blocking-overlay="true">
    <div ref={dialog} className="team-message-panel" role="dialog" aria-modal="true" aria-label="团队消息" tabIndex={-1} onKeyDown={event => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select, a[href]') ?? [])].filter(v => v.offsetParent !== null)
        const first = items[0], last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="team-panel-header"><strong>团队消息</strong><span>团队共同接待，每位用户独立会话</span><button onClick={onClose} aria-label="关闭团队消息">关闭</button></header>
      <div className="team-panel-layout">
        <aside className="team-inbox">
          <div className="team-tabs"><button aria-pressed={side === 'team'} onClick={() => { setSide('team') }}>团队收件箱</button><button aria-pressed={side === 'external'} onClick={() => { setSide('external') }}>我的咨询</button></div>
          <div className="team-list-actions"><button disabled={loading} onClick={() => { void refresh() }}>刷新</button><select aria-label="团队通道与成员管理" value="" onChange={e => { if (e.target.value) { setSettings(e.target.value); setSelected(undefined) } }}><option value="">管理我的团队…</option>{teams.map(t => <option key={t.jotmoId} value={t.teamRef}>{t.name}</option>)}</select></div>
          <nav aria-label="团队会话">{page.items.map(c => <button key={c.key} className="team-conversation-row" aria-current={selected?.key === c.key} onClick={() => { setSelected(c); setSettings(undefined) }}>
            <TeamAvatar identity={c.side === 'team' && c.visitor ? c.visitor : { nickname: c.channel.name, ...(c.channel.imageRef ? { imageRef: c.channel.imageRef } : {}) }} />
            <span><strong>{c.side === 'team' ? c.visitor?.nickname || '用户' : c.channel.name}</strong><small>{c.side === 'team' ? c.channel.name : '团队咨询'}{c.needsReply ? ' · 待回复' : ''}</small></span>{c.unread > 0 && <b>{c.unread}</b>}
          </button>)}</nav>
          {!loading && page.items.length === 0 && <p className="team-empty">还没有团队消息</p>}
          {page.hasMore && <button disabled={loading} onClick={() => { void refresh(page.nextCursor) }}>加载更多会话</button>}
          <details><summary>通过通道链接联系团队</summary><form onSubmit={e => { e.preventDefault(); let ref = link.trim(); try { ref = new URL(ref).searchParams.get('channel') || ref } catch {} void open(ref).catch(v => { setError(errorText(v)) }) }}><input aria-label="团队消息通道链接" placeholder="粘贴团队消息链接" value={link} onChange={e => { setLink(e.target.value) }} /><button>打开通道</button></form></details>
          <details><summary>加入 / 创建团队</summary><form onSubmit={e => { e.preventDefault(); void membership('join') }}><input aria-label="要加入的团队即我号" placeholder="团队即我号" value={joinId} disabled={membershipBusy} onChange={e => { setJoinId(e.target.value); joinUid.current = crypto.randomUUID() }} /><button disabled={membershipBusy || !joinId.trim()}>申请加入</button></form>
            <form onSubmit={e => { e.preventDefault(); void membership('create') }}><input aria-label="新团队名称" placeholder="新团队名称" value={teamName} disabled={membershipBusy} onChange={e => { setTeamName(e.target.value); createUid.current = crypto.randomUUID() }} /><input aria-label="新团队即我号" placeholder="新团队即我号" value={newTeamId} disabled={membershipBusy} onChange={e => { setNewTeamId(e.target.value); createUid.current = crypto.randomUUID() }} /><button disabled={membershipBusy || !newTeamId.trim() || !teamName.trim()}>创建团队</button></form><p role="status">{membershipResult}</p></details>
        </aside>
        <main className="team-main">{error && <div role="alert" className="team-error">{error}</div>}
          {settings ? <TeamChannelSettings key={settings} teamRef={settings} accountKey={accountKey} onChanged={() => { void refreshTeams().catch(e => { if (!controller.current.signal.aborted) setError(errorText(e)) }); void refresh() }} />
            : selected ? <TeamConversationPane key={selected.key} conversation={selected} accountKey={accountKey} onChanged={() => { void refresh() }} />
              : <div className="team-empty"><h2>选择一段团队会话</h2><p>团队成员共同接收和回复；外部用户只看到自己的咨询与团队回复。</p></div>}
        </main>
      </div>
    </div>
  </div>
}

export function teamDraftContent(draft: Pick<Draft, 'text' | 'assets'>): TeamContent {
  return { text_content: draft.text, template_kind: draft.assets.length ? 2 : 1,
    ...(draft.assets.length ? { content_payload: { payload_kind: 2, schema_version: 1, text_state: draft.text.trim() ? 1 : 3,
      media_refs: draft.assets.map((f, index) => ({ file_asset_uid: f.fileAssetUid, render_role: 1, sort_order: index, file_name: f.fileName })) } } : {}) }
}
export function TeamConversationPane({ conversation, accountKey, onChanged }: { conversation: TeamConversation; accountKey: string; onChanged(): void }) {
  const storageKey = `arkme.team.draft:${accountKey}:${conversation.key}`
  const [draft, setDraft] = useState<Draft>(() => loadTeamDraft(localStorage, storageKey)), [timeline, setTimeline] = useState<TeamTimeline>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false)
  const [receipt, setReceipt] = useState<{ message: TeamMessage; value: TeamReceipts }>()
  const [editing, setEditing] = useState<{ message: TeamMessage; text: string; needsReload?: boolean; latestText?: string }>(), [withdraw, setWithdraw] = useState<TeamMessage>()
  const ctrl = useRef(new AbortController()), generation = useRef(0), bottom = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), visible = useRef(false), read = useRef(conversation.myReadSeq)
  const sendBusy = useRef(false), receiptsBusy = useRef(false)
  const latest = useRef(timeline); latest.current = timeline
  useEffect(() => { try { persistTeamDraft(localStorage, storageKey, draft) } catch { setError('草稿未能保存到本机，请勿关闭窗口') } }, [storageKey, draft])
  useEffect(() => () => { ctrl.current.abort() }, [])
  const refresh = useCallback(async (beforeSeq = 0) => {
    const token = ++generation.current
    try {
      const data = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, beforeSeq }, ctrl.current.signal)
      if (ctrl.current.signal.aborted || token !== generation.current) return
      setTimeline(old => beforeSeq && old ? { ...data, messages: [...new Map([...data.messages, ...old.messages].map(m => [m.key, m])).values()].sort((a, b) => a.seq - b.seq) } : { ...data, messages: [...data.messages].sort((a, b) => a.seq - b.seq) })
      setError('')
      if (!beforeSeq && (visible.current || !latest.current)) requestAnimationFrame(() => { bottom.current?.scrollIntoView({ block: 'end' }) })
    } catch (e) { if (!ctrl.current.signal.aborted && token === generation.current) { setError(errorText(e)); if (inaccessible(e)) { setTimeline(undefined); setReceipt(undefined); setEditing(undefined) } } }
  }, [conversation.ref])
  useEffect(() => { void refresh(); return subscribeTeamMessageChanges(account => { if (account === accountKey) { void refresh(); setReceipt(undefined) } }) }, [refresh, accountKey])
  const advance = useCallback(() => {
    const current = latest.current
    if (!current || !visible.current || document.visibilityState !== 'visible' || !document.hasFocus()) return
    const sequence = Math.max(0, ...current.messages.map(m => m.seq))
    if (!sequence || sequence <= read.current) return
    const previous = read.current; read.current = sequence
    void callArkme('team.app.read', { conversationRef: conversation.ref, readSeq: sequence }, ctrl.current.signal).then(onChanged).catch(() => { read.current = previous })
  }, [conversation.ref, onChanged])
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { visible.current = entries.some(v => v.isIntersecting); advance() }, { root: scroller.current, threshold: 1 })
    if (bottom.current) observer.observe(bottom.current)
    window.addEventListener('focus', advance); document.addEventListener('visibilitychange', advance); advance()
    return () => { observer.disconnect(); window.removeEventListener('focus', advance); document.removeEventListener('visibilitychange', advance) }
  }, [advance, timeline])
  const send = async (confirm = false) => {
    if (!timeline || sendBusy.current) return
    const attempt = draft.attempt ?? { uid: crypto.randomUUID(), content: teamDraftContent(draft), expectedReplySeq: timeline.conversation.latestTeamReplySeq }
    const acceptedDraft = { ...draft, attempt }
    try { persistTeamDraft(localStorage, storageKey, acceptedDraft) } catch { setError('无法保存发送请求，请释放本机存储后再发送'); return }
    sendBusy.current = true; setDraft(acceptedDraft); setBusy(true); setError('')
    try {
      const result = confirm && attempt.message
        ? await callArkme<TeamSendResult>('team.app.send.confirm', { messageRef: attempt.message.ref, expectedReplySeq: timeline.conversation.latestTeamReplySeq }, ctrl.current.signal)
        : await callArkme<TeamSendResult>('team.app.send', { conversationRef: conversation.ref, clientUid: attempt.uid, content: attempt.content, expectedReplySeq: attempt.expectedReplySeq }, ctrl.current.signal)
      if (ctrl.current.signal.aborted) return
      let notice = ''
      if (result.message?.state === 'published') { const empty = { text: '', assets: [] }; persistTeamDraft(localStorage, storageKey, empty); setDraft(empty); onChanged() }
      else if (result.message?.state === 'cancelled' || result.message?.state === 'withdrawn') { const kept = { text: draft.text, assets: draft.assets }; persistTeamDraft(localStorage, storageKey, kept); setDraft(kept); notice = '原发送已取消或撤回，草稿已保留，可修改后重新发送' }
      else { setDraft(v => ({ ...v, attempt: { ...attempt, ...(result.message ? { message: result.message } : {}), ...(result.reason ? { reason: result.reason } : {}) } })); notice = result.reason === 'reply_conflict' ? '其他成员刚刚回复。请阅读新消息，再确认是否仍需发送。' : '消息正在处理中，请使用原请求重试。' }
      await refresh()
      if (!ctrl.current.signal.aborted && notice) setError(notice)
    } catch (e) {
      if (!ctrl.current.signal.aborted) {
        const code = (e as { body?: { code?: string } })?.body?.code
        if (code === 'team-reply_conflict') await refresh()
        // A validated pre-admission rejection has no accepted operation.
        // Unknown transport outcomes must retain the original request key.
        if (code === 'team-invalid_request' && !attempt.message) {
          const kept = { text: draft.text, assets: draft.assets }
          try { persistTeamDraft(localStorage, storageKey, kept); setDraft(kept) }
          catch { setError('草稿未能保存到本机，请勿关闭窗口'); return }
        }
        if (!ctrl.current.signal.aborted) setError(errorText(e))
      }
    }
    finally { sendBusy.current = false; if (!ctrl.current.signal.aborted) setBusy(false) }
  }
  const upload = async (files: FileList | null) => {
    if (!files) return
    setUploading(true)
    try { for (const file of [...files]) { const asset = await createArkmeSdk().upload(file, { signal: ctrl.current.signal }); if (!ctrl.current.signal.aborted) setDraft(v => ({ ...v, assets: [...v.assets, asset] })) } }
    catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) }
    finally { if (!ctrl.current.signal.aborted) setUploading(false) }
  }
  const cancelAccepted = async () => {
    if (!draft.attempt?.message) return
    setBusy(true)
    try { await callArkme('team.app.withdraw', { messageRef: draft.attempt.message.ref }, ctrl.current.signal); setDraft({ text: draft.text, assets: draft.assets }); setError(''); await refresh() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  const mutateMessage = async () => {
    if (busy || editing?.needsReload) return
    setBusy(true)
    try {
      if (withdraw) await callArkme('team.app.withdraw', { messageRef: withdraw.ref }, ctrl.current.signal)
      else if (editing?.message.content) await callArkme('team.app.edit', { messageRef: editing.message.ref, version: editing.message.version, content: { ...editing.message.content, text_content: editing.text } }, ctrl.current.signal)
      setWithdraw(undefined); setEditing(undefined); await refresh(); onChanged()
    } catch (e) {
      if (!ctrl.current.signal.aborted) {
        setError(errorText(e))
        if ((e as { body?: { code?: string } })?.body?.code === 'team-version_conflict') setEditing(v => v ? { ...v, needsReload: true } : v)
      }
    } finally { if (!ctrl.current.signal.aborted) setBusy(false) }
  }
  const reloadEdit = async () => {
    if (!editing || busy) return
    setBusy(true)
    try {
      const page = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, beforeSeq: editing.message.seq + 1 }, ctrl.current.signal)
      const current = page.messages.find(m => m.key === editing.message.key)
      if (!current?.canEdit || current.state !== 'published' || current.contentStatus !== 'available' || !current.content) throw new Error('此消息已不可编辑，草稿已保留')
      if (!ctrl.current.signal.aborted) { setEditing({ ...editing, message: current, needsReload: false, latestText: current.content.text_content ?? '' }); setError('') }
    } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) }
    finally { if (!ctrl.current.signal.aborted) setBusy(false) }
  }
  const readReceipts = async (message: TeamMessage, more = false) => {
    if (receiptsBusy.current) return
    receiptsBusy.current = true
    try {
      const value = await callArkme<TeamReceipts>('team.app.receipts', { messageRef: message.ref, ...(more ? { cursor: receipt?.value.nextCursor } : {}) }, ctrl.current.signal)
      if (!ctrl.current.signal.aborted) setReceipt(previous => more ? previous?.message.key === message.key ? { message, value: { ...value, members: [...previous.value.members, ...value.members] } } : previous : { message, value })
    } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) }
    finally { receiptsBusy.current = false }
  }
  const current = timeline?.conversation ?? conversation
  return <section className="team-conversation-pane">
    <header><div><strong>{current.side === 'team' ? current.visitor?.nickname : current.channel.name}</strong><small>{current.channel.name} · {current.side === 'team' ? '团队共同回复' : '仅你与团队可见'}</small></div><button onClick={() => { void refresh() }}>刷新</button>
      {current.side === 'team' && current.channel.canManage && <button onClick={() => { void callArkme('team.app.block', { conversationRef: current.ref, blocked: !current.blocked }, ctrl.current.signal).then(() => refresh()).catch(e => { setError(errorText(e)) }) }}>{current.blocked ? '解除屏蔽' : '屏蔽此用户'}</button>}
    </header>
    {error && <div role="alert" className="team-error">{error}</div>}
    <div ref={scroller} className="team-message-list" aria-label="团队消息记录">
      {timeline?.hasMore && <button onClick={() => { void refresh(timeline.beforeSeq) }}>加载更早消息</button>}
      {timeline?.messages.map(m => <article key={m.key} className={`team-message ${m.own ? 'is-own' : ''}`}>
        <TeamAvatar identity={m.sender} {...(m.side === 'team' ? { team: { nickname: current.channel.name, ...(current.channel.imageRef ? { imageRef: current.channel.imageRef } : {}) } } : {})} />
        <div className="team-message-body"><div className="team-message-meta"><strong>{m.sender.nickname}</strong>{m.side === 'team' && <span>· {current.channel.name}</span>}<time>{new Date(m.createdAt).toLocaleString()}</time></div>
          {m.state !== 'published' ? <p className="team-empty">{m.state === 'withdrawn' ? '这条消息已撤回' : '消息未发布'}</p> : m.contentStatus !== 'available' ? <p>内容当前不可用</p> : <><p className="team-message-text">{m.content?.text_content}</p>{m.media.map((f, index) => <TeamMessageAttachment key={`${m.key}:${m.version}:${index}`} media={f} signal={ctrl.current.signal} onError={setError} />)}</>}
          <div className="team-message-actions">{m.canEdit && <button onClick={() => { setEditing({ message: m, text: m.content?.text_content ?? '' }); setWithdraw(undefined) }}>编辑</button>}{m.canWithdraw && <button onClick={() => { setWithdraw(m); setEditing(undefined) }}>撤回</button>}{(current.side === 'team' || m.side === 'external') && <button onClick={() => { void readReceipts(m) }}>查看阅读状态</button>}</div>
        </div>
      </article>)}
      <div ref={bottom} className="team-read-sentinel" />
    </div>
    {receipt && <section className="team-receipts"><button onClick={() => { setReceipt(undefined) }}>关闭阅读状态</button><p>{current.side === 'external' ? receipt.value.teamRead ? '团队已查看' : '团队未查看' : receipt.value.visitorRead ? '用户已查看' : '用户未查看'}</p>{receipt.value.members.map((v, i) => <span key={i}>{v.nickname} · {v.read ? '已读' : '未读'} </span>)}{receipt.value.hasMore && <button onClick={() => { void readReceipts(receipt.message, true) }}>更多成员</button>}</section>}
    {(editing || withdraw) && <section className="team-edit"><p>{withdraw ? '只撤回当前团队会话中的消息引用，其他位置的引用保留。' : '修改会更新同一条快记，所有引用它的位置都会看到新内容。'}</p>{editing?.latestText !== undefined && <p>最新内容：{editing.latestText}。你的草稿已保留，确认修改将覆盖此版本。</p>}{editing && <textarea disabled={busy} aria-label="修改消息内容" value={editing.text} onChange={e => { setEditing({ ...editing, text: e.target.value }) }} />}{editing?.needsReload && <button disabled={busy} onClick={() => { void reloadEdit() }}>读取最新版本</button>}<button disabled={busy || editing?.needsReload} onClick={() => { void mutateMessage() }}>{editing?.latestText !== undefined ? '确认覆盖最新版本' : `确认${withdraw ? '撤回' : '修改'}`}</button><button disabled={busy} onClick={() => { setEditing(undefined); setWithdraw(undefined) }}>取消</button></section>}
    <form className="team-composer" onSubmit={e => { e.preventDefault(); void send() }}>
      {(!current.channel.enabled || current.blocked) && <p>当前通道暂停接收新消息</p>}
      <textarea aria-label="团队消息内容" placeholder={current.side === 'team' ? '代表团队回复…' : '向团队描述你的问题…'} value={draft.text} disabled={!!draft.attempt || uploading} maxLength={20_000} onChange={e => { setDraft(v => ({ ...v, text: e.target.value })) }} />
      {draft.assets.map((v, i) => <span key={`${v.fileAssetUid}:${i}`}>{v.fileName}<button type="button" disabled={!!draft.attempt} onClick={() => { setDraft(d => ({ ...d, assets: d.assets.filter((_, index) => index !== i) })) }}>移除</button></span>)}
      <div className="team-compose-actions"><label>添加附件<input type="file" multiple disabled={!!draft.attempt || uploading} onChange={e => { void upload(e.target.files); e.target.value = '' }} /></label>{uploading && <span>正在上传…</span>}
        {draft.attempt?.reason === 'reply_conflict' ? <><button type="button" disabled={busy} onClick={() => { void send(true) }}>已读新回复，仍要发送</button><button type="button" disabled={busy} onClick={() => { void cancelAccepted() }}>取消本次发送，保留草稿</button></> : <button disabled={busy || uploading || !timeline || (!draft.text.trim() && !draft.assets.length) || (!draft.attempt && (!current.channel.enabled || current.blocked))}>{busy ? '处理中…' : draft.attempt ? '使用原请求重试' : '发送'}</button>}
      {draft.attempt?.message?.state === 'preparing' && draft.attempt.reason !== 'reply_conflict' && <button type="button" disabled={busy} onClick={() => { void cancelAccepted() }}>取消本次发送，保留草稿</button>}
      </div>
    </form>
  </section>
}

function TeamChannelSettings({ teamRef, accountKey, onChanged }: { teamRef: string; accountKey: string; onChanged(): void }) {
  const [channel, setChannel] = useState<TeamChannel>(), [members, setMembers] = useState<TeamMembers>(), [applications, setApplications] = useState<TeamPage<TeamApplication>>()
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ label: string; run(): Promise<unknown> }>()
  const ctrl = useRef(new AbortController()), generation = useRef(0)
  useEffect(() => () => { ctrl.current.abort() }, [])
  const loadMembers = async (cursor?: string) => { const page = await callArkme<TeamMembers>('team.app.members', { teamRef, ...(cursor ? { pageCursor: cursor } : {}) }, ctrl.current.signal); if (!ctrl.current.signal.aborted) setMembers(old => cursor && old ? { ...page, items: [...old.items, ...page.items] } : page) }
  const loadApplications = async (cursor?: string) => { const page = await callArkme<TeamPage<TeamApplication>>('team.app.applications', { teamRef, ...(cursor ? { cursor } : {}) }, ctrl.current.signal); if (!ctrl.current.signal.aborted) setApplications(old => cursor && old ? { ...page, items: [...old.items, ...page.items] } : page) }
  const refresh = async () => {
    const token = ++generation.current
    try { const data = await callArkme<TeamChannel>('team.app.channel', { teamRef }, ctrl.current.signal); if (ctrl.current.signal.aborted || token !== generation.current) return; setChannel(data); await loadMembers(); if (data.canManage) await loadApplications(); setError('') }
    catch (e) { if (!ctrl.current.signal.aborted) { setError(errorText(e)); if (inaccessible(e)) { setChannel(undefined); setMembers(undefined); setApplications(undefined) } } }
  }
  useEffect(() => { void refresh(); return subscribeTeamMessageChanges(account => { if (account === accountKey) void refresh() }) }, [teamRef, accountKey])
  const mutate = async (run: () => Promise<unknown>) => { setBusy(true); try { await run(); setConfirm(undefined); await refresh(); onChanged() } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) } finally { if (!ctrl.current.signal.aborted) setBusy(false) } }
  const configure = (enabled: boolean, rotate = false) => callArkme('team.app.channel.configure', { teamRef, revision: channel?.revision ?? 0, enabled, rotate }, ctrl.current.signal)
  return <section className="team-settings"><h2>{channel?.name ?? '团队管理'}</h2>{error && <p role="alert" className="team-error">{error}</p>}
    <h3>团队消息通道</h3><p>通道中的每位用户都有独立会话。团队成员可共同查看和回复，用户无法查看团队成员列表。</p>
    {channel?.publicRef && <><p>{channel.enabled ? '正在接收消息' : '已暂停接收新消息'}</p><input aria-label="团队消息分享链接" readOnly value={channel.link} /><button onClick={() => { void navigator.clipboard.writeText(channel.link).then(() => { setNotice('通道链接已复制') }).catch(() => { setNotice('复制失败，请手动复制链接') }) }}>复制通道链接</button></>}
    {channel?.canManage && <div><button disabled={busy} onClick={() => { if (!channel.publicRef) setConfirm({ label: '建立通道后，现有成员均可查看全部团队咨询。请核对下方成员名单；此后新成员须经所有者审批。确认建立？', run: () => configure(true) }); else void mutate(() => configure(!channel.enabled)) }}>{!channel.publicRef ? '建立团队消息通道' : channel.enabled ? '暂停通道' : '开启通道'}</button>{channel.publicRef && <button disabled={busy} onClick={() => { setConfirm({ label: '重置后旧链接失效，已存在的会话继续保留。确认重置？', run: () => configure(channel.enabled, true) }) }}>重置分享链接</button>}</div>}
    <p role="status">{notice}</p>
    <h3>团队成员</h3><p>启用消息通道后，新成员须由所有者审批加入；退出或被移除后立即失去团队访问权。</p>
    {members?.items.map(m => <div className="team-member-row" key={m.userRef}><span>{m.displayName}{m.jotmoId ? ` · @${m.jotmoId}` : ''}</span><span>{m.role === 'owner' ? '所有者' : m.role === 'admin' ? '管理员' : '成员'}</span>{m.canRemove && <button disabled={busy} onClick={() => { setConfirm({ label: `确认移除 ${m.displayName}？`, run: () => callArkme('team.app.member.remove', { userRef: m.userRef }, ctrl.current.signal) }) }}>移除</button>}</div>)}
    {members?.hasMore && <button onClick={() => { void loadMembers(members.nextPageCursor).catch(e => { setError(errorText(e)) }) }}>加载更多成员</button>}
    {members && members.team.currentUserRole !== 'owner' && <button disabled={busy} onClick={() => { setConfirm({ label: '退出后将无法查看或回复该团队消息，确认退出？', run: () => callArkme('team.app.leave', { teamRef }, ctrl.current.signal) }) }}>退出团队</button>}
    {channel?.canManage && <><h3>加入申请</h3>{applications?.items.length === 0 && <p>没有待处理申请</p>}{applications?.items.map(a => <div className="team-member-row" key={a.ref}><span>{a.name} · {new Date(a.requestedAt).toLocaleString()} · {a.state}</span>{a.state === 'pending' && <><button disabled={busy} onClick={() => { setConfirm({ label: `同意 ${a.name} 加入后，对方可查看全部团队咨询历史并代表团队回复。确认同意？`, run: () => callArkme('team.app.application.decide', { applicationRef: a.ref, approve: true }, ctrl.current.signal) }) }}>同意</button><button disabled={busy} onClick={() => { void mutate(() => callArkme('team.app.application.decide', { applicationRef: a.ref, approve: false }, ctrl.current.signal)) }}>拒绝</button></>}</div>)}{applications?.hasMore && <button onClick={() => { void loadApplications(applications.nextCursor).catch(e => { setError(errorText(e)) }) }}>更多申请</button>}</>}
    {confirm && <div className="team-confirm" role="alert"><p>{confirm.label}</p><button disabled={busy} onClick={() => { void mutate(confirm.run) }}>确认</button><button disabled={busy} onClick={() => { setConfirm(undefined) }}>取消</button></div>}
  </section>
}
