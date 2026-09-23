import { Paperclip } from '@phosphor-icons/react/dist/icons/Paperclip'
import { startTeamDirectory, subscribeTeamDirectory, readTeamDirectory, refreshTeamDirectory, discardTeamDirectory } from './team-conversation-directory.js'
import { startTeamAttention } from './team-attention-store.js'
import { showBrowserNotification } from './browser-notification.js'
import { teamText as tr } from './team-messaging-i18n.js'
import { useArkmeLocale } from './locale.js'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { callArkme } from './api.js'
import { createArkmeSdk } from '../sdk/index.js'
import type { ArkmeUploadedAsset } from '../types.js'
import type { TeamApplication, TeamChannel, TeamContent, TeamConversation, TeamIdentity, TeamMessage, TeamOpen, TeamPage, TeamReceipts, TeamSendResult, TeamTimeline } from '../team-app-contract.js'
import { openTeamMessages, subscribeTeamMessageChanges, type TeamMessageIntent } from './team-messaging-events.js'
import { loadTeamDraft, persistTeamDraft, type TeamDraft as Draft } from './team-message-draft.js'
import { TeamMessageAttachment } from './TeamMessageAttachment.js'

function errorText(error: unknown): string { return error instanceof Error ? tr(error.message) : tr("操作失败，请重试") }
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
  useArkmeLocale()
  useEffect(() => {
    if (!active) return
    let live = true
    const notices = new Set<() => void>()
    const stopDirectory = startTeamDirectory(accountKey)
    const stop = startTeamAttention(accountKey, value => {
      if (document.visibilityState === 'visible' && document.hasFocus()) return
      const close = showBrowserNotification(tr('团队消息'), value.external || value.team ? tr('你有新的团队消息，点击查看') : tr('有待处理的团队加入申请'), `arkme-team-${accountKey}`, () => {
        if (live) openTeamMessages({ kind: 'inbox', side: value.external ? 'external' : 'team' })
      })
      if (close) { for (const previous of notices) previous(); notices.clear(); notices.add(close) }
    })
    return () => { live = false; stop(); stopDirectory(); for (const close of notices) close() }
  }, [accountKey, active])
  return null
}

/** The existing workspace owns navigation. Team owns only its conversation content. */
export function TeamMessagingPanel({ accountKey, intent }: { accountKey: string; intent: TeamMessageIntent }) {
  useArkmeLocale()
  const directory = useSyncExternalStore(subscribeTeamDirectory, () => readTeamDirectory(accountKey), () => readTeamDirectory(accountKey))
  const [selected, setSelected] = useState<TeamConversation>()
  const [channel, setChannel] = useState<TeamChannel>()
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setSelected(undefined); setChannel(undefined); setError(''); setLoading(true)
    const run = async () => {
      if (intent.kind === 'conversation') { setSelected(intent.conversation); return }
      if (intent.kind === 'inbox') { await refreshTeamDirectory(accountKey); return }
      if (intent.kind === 'team') {
        const value = await callArkme<TeamChannel>('team.app.channel', { teamRef: intent.teamRef }, controller.signal)
        if (!controller.signal.aborted) setChannel(value)
        return
      }
      const publicRef = intent.kind === 'official'
        ? (await callArkme<TeamChannel>('team.app.official', {}, controller.signal)).publicRef : intent.publicRef
      const value = await callArkme<TeamOpen>('team.app.open', { publicRef }, controller.signal)
      if (controller.signal.aborted) return
      setChannel(value.channel)
      if (value.conversation) setSelected(value.conversation)
      void refreshTeamDirectory(accountKey)
    }
    void run().catch(e => { if (!controller.signal.aborted) setError(errorText(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [accountKey, intent, attempt])
  if (selected) return <div className="team-message-panel">
    <TeamConversationPane key={`${selected.side}:${selected.key}`} accountKey={accountKey} conversation={selected}
      onChanged={() => { void refreshTeamDirectory(accountKey) }}
      onAccessLost={() => { discardTeamDirectory(accountKey, selected) }} />
  </div>
  const items = directory.items.filter(c => channel ? c.side === 'team' && c.channel.jotmoId === channel.jotmoId : intent.kind !== 'inbox' || !intent.side || c.side === intent.side)
  const direct = intent.kind === 'official' || intent.kind === 'link' || intent.kind === 'conversation'
  return <section className="team-message-panel" aria-label={tr('团队对话')}>
    <header className="team-panel-header"><strong>{channel?.name ?? tr(intent.kind === 'official' ? '联系作者' : '团队对话')}</strong></header>
    {loading ? <div className="team-empty" role="status">{tr('正在打开对话…')}</div>
      : error ? <div className="team-opening-error" role="alert"><p>{error}</p><button onClick={() => { setAttempt(v => v + 1) }}>{tr('重试')}</button></div>
      : <div className="team-conversation-directory">
        {!direct && <p className="team-empty">{tr('团队成员共同查看和回复，每位外部用户的对话彼此独立。')}</p>}
        {items.map(c => <button key={`${c.side}:${c.key}`} className="team-conversation-row" onClick={() => { openTeamMessages({ kind: 'conversation', conversation: c }) }}>
          <TeamAvatar identity={c.side === 'team' ? c.visitor ?? { nickname: tr('用户') } : { nickname: c.channel.name, ...(c.channel.imageRef ? { imageRef: c.channel.imageRef } : {}) }} />
          <span><strong>{c.side === 'team' ? c.visitor?.nickname : c.channel.name}</strong><small>{c.side === 'team' ? `${c.channel.name} · ` : ''}{c.preview?.text}</small></span>
          {c.unread > 0 && <b>{c.unread}</b>}
        </button>)}
        {items.length === 0 && <p className="team-empty">{tr('还没有团队对话')}</p>}
        {directory.hasMore && <button disabled={directory.loading} onClick={() => { void refreshTeamDirectory(accountKey, true) }}>{tr('加载更多对话')}</button>}
      </div>}
  </section>
}

export function teamDraftContent(draft: Pick<Draft, 'text' | 'assets'>): TeamContent {
  return { text_content: draft.text, template_kind: draft.assets.length ? 2 : 1,
    ...(draft.assets.length ? { content_payload: { payload_kind: 2, schema_version: 1, text_state: draft.text.trim() ? 1 : 3,
      media_refs: draft.assets.map((f, index) => ({ file_asset_uid: f.fileAssetUid, render_role: 1, sort_order: index, file_name: f.fileName })) } } : {}) }
}
export function TeamConversationPane({ conversation, accountKey, onChanged, onAccessLost }: { conversation: TeamConversation; accountKey: string; onChanged(): void; onAccessLost?(): void }) {
  useArkmeLocale()
  const storageKey = `arkme.team.draft:${accountKey}:${conversation.key}`
  const [draft, setDraft] = useState<Draft>(() => loadTeamDraft(localStorage, storageKey)), [timeline, setTimeline] = useState<TeamTimeline>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false)
  const [receipt, setReceipt] = useState<{ message: TeamMessage; value: TeamReceipts }>()
  const [editing, setEditing] = useState<{ message: TeamMessage; text: string; needsReload?: boolean; latestText?: string }>(), [withdraw, setWithdraw] = useState<TeamMessage>()
  const ctrl = useRef(new AbortController()), generation = useRef(0), bottom = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), visible = useRef(false), read = useRef(conversation.myReadSeq)
  const fileInput = useRef<HTMLInputElement>(null)
  const sendBusy = useRef(false), receiptsBusy = useRef(false)
  const latest = useRef(timeline); latest.current = timeline
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost
  useEffect(() => { try { persistTeamDraft(localStorage, storageKey, draft) } catch { setError(tr("草稿未能保存到本机，请勿关闭窗口")) } }, [storageKey, draft])
  useEffect(() => () => { ctrl.current.abort() }, [])
  const receiptRef = useRef(receipt); receiptRef.current = receipt
  const receiptGeneration = useRef(0)
  const readReceipts = useCallback(async (message: TeamMessage, more = false) => {
    if (receiptsBusy.current) return
    receiptsBusy.current = true
    const token = ++receiptGeneration.current, previous = receiptRef.current?.message.key === message.key ? receiptRef.current : undefined
    try {
      let value = await callArkme<TeamReceipts>('team.app.receipts', { messageRef: message.ref, ...(more ? { cursor: previous?.value.nextCursor } : {}) }, ctrl.current.signal)
      const members = [...(more ? previous?.value.members ?? [] : []), ...value.members], seen = new Set<string>()
      while (!more && members.length < (previous?.value.members.length ?? 0) && value.hasMore) {
        if (!value.nextCursor || seen.has(value.nextCursor)) throw new Error(tr('消息分页异常，请重试'))
        seen.add(value.nextCursor)
        if (ctrl.current.signal.aborted || token !== receiptGeneration.current) return
        value = await callArkme<TeamReceipts>('team.app.receipts', { messageRef: message.ref, cursor: value.nextCursor }, ctrl.current.signal)
        members.push(...value.members)
      }
      if (!ctrl.current.signal.aborted && token === receiptGeneration.current) { const next = { message, value: { ...value, members } }; receiptRef.current = next; setReceipt(next) }
    } catch (e) { if (!ctrl.current.signal.aborted && token === receiptGeneration.current) setError(errorText(e)) }
    finally { receiptsBusy.current = false }
  }, [])
  const refresh = useCallback(async (beforeSeq = 0) => {
    const token = ++generation.current
    try {
      let data = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, beforeSeq }, ctrl.current.signal)
      const head = data.conversation, old = latest.current, oldest = old?.messages[0]?.seq ?? 0
      const messages = new Map((beforeSeq && old ? [...old.messages, ...data.messages] : data.messages).map(m => [m.key, m]))
      while (!beforeSeq && oldest > 0 && data.hasMore && data.beforeSeq > oldest) {
        const before = data.beforeSeq
        if (ctrl.current.signal.aborted || token !== generation.current) return
        data = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, beforeSeq: before }, ctrl.current.signal)
        if (data.hasMore && (!data.beforeSeq || data.beforeSeq >= before)) throw new Error(tr("消息分页异常，请重试"))
        for (const message of data.messages) messages.set(message.key, message)
      }
      data = { ...data, conversation: head, messages: [...messages.values()].sort((a,b) => a.seq-b.seq) }
      const element = scroller.current
      const anchor = element && [...element.querySelectorAll<HTMLElement>('[data-team-message-key]')].find(node => node.getBoundingClientRect().bottom >= element.getBoundingClientRect().top)
      const anchorKey = anchor?.dataset.teamMessageKey, anchorTop = anchor?.getBoundingClientRect().top ?? 0
      if (ctrl.current.signal.aborted || token !== generation.current) return
      latest.current = data
      setTimeline(data)
      if (anchorKey && (beforeSeq || !visible.current)) requestAnimationFrame(() => { const node = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-team-message-key]') ?? [])].find(v => v.dataset.teamMessageKey === anchorKey); if (node && scroller.current) scroller.current.scrollTop += node.getBoundingClientRect().top - anchorTop })
      setError('')
      if (!beforeSeq && (visible.current || !old)) requestAnimationFrame(() => { bottom.current?.scrollIntoView({ block: 'end' }) })
      if (receiptRef.current) await readReceipts(receiptRef.current.message)
      if (beforeSeq && head.lastSeq > (data.messages.at(-1)?.seq ?? 0)) void refresh()
    } catch (e) { if (!ctrl.current.signal.aborted && token === generation.current) { setError(errorText(e)); if (inaccessible(e)) { accessLost.current?.(); setTimeline(undefined); ++receiptGeneration.current; receiptRef.current = undefined; setReceipt(undefined); setEditing(undefined) } } }
  }, [conversation.ref, readReceipts])
  useEffect(() => { void refresh(); return subscribeTeamMessageChanges(account => { if (account === accountKey) { void refresh() } }) }, [refresh, accountKey])
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
    try { persistTeamDraft(localStorage, storageKey, acceptedDraft) } catch { setError(tr("无法保存发送请求，请释放本机存储后再发送")); return }
    sendBusy.current = true; setDraft(acceptedDraft); setBusy(true); setError('')
    try {
      const result = confirm && attempt.message
        ? await callArkme<TeamSendResult>('team.app.send.confirm', { messageRef: attempt.message.ref, expectedReplySeq: timeline.conversation.latestTeamReplySeq }, ctrl.current.signal)
        : await callArkme<TeamSendResult>('team.app.send', { conversationRef: conversation.ref, clientUid: attempt.uid, content: attempt.content, expectedReplySeq: attempt.expectedReplySeq }, ctrl.current.signal)
      if (ctrl.current.signal.aborted) return
      let notice = ''
      if (result.message?.state === 'published') { const empty = { text: '', assets: [] }; persistTeamDraft(localStorage, storageKey, empty); setDraft(empty); onChanged() }
      else if (result.message?.state === 'cancelled' || result.message?.state === 'withdrawn') { const kept = { text: draft.text, assets: draft.assets }; persistTeamDraft(localStorage, storageKey, kept); setDraft(kept); notice = tr("原发送已取消或撤回，草稿已保留，可修改后重新发送") }
      else { setDraft(v => ({ ...v, attempt: { ...attempt, ...(result.message ? { message: result.message } : {}), ...(result.reason ? { reason: result.reason } : {}) } })); notice = result.reason === 'reply_conflict' ? tr("其他成员刚刚回复。请阅读新消息，再确认是否仍需发送。") : tr("消息正在处理中，请使用原请求重试。") }
      await refresh()
      if (!ctrl.current.signal.aborted && notice) setError(notice)
    } catch (e) {
      if (!ctrl.current.signal.aborted) {
        const code = (e as { body?: { code?: string } })?.body?.code
        if (code === 'team-reply_conflict') await refresh()
        // A validated pre-admission rejection has no accepted operation.
        // Unknown transport outcomes must retain the original request key.
        if (['team-invalid_request', 'team-channel_paused', 'team-conversation_blocked'].includes(code ?? '') && !attempt.message) {
          const kept = { text: draft.text, assets: draft.assets }
          try { persistTeamDraft(localStorage, storageKey, kept); setDraft(kept) }
          catch { setError(tr("草稿未能保存到本机，请勿关闭窗口")); return }
        }
        if (code === 'team-channel_paused' || code === 'team-conversation_blocked') await refresh()
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
      if (!current?.canEdit || current.state !== 'published' || current.contentStatus !== 'available' || !current.content) throw new Error(tr("此消息已不可编辑，草稿已保留"))
      if (!ctrl.current.signal.aborted) { setEditing({ ...editing, message: current, needsReload: false, latestText: current.content.text_content ?? '' }); setError('') }
    } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) }
    finally { if (!ctrl.current.signal.aborted) setBusy(false) }
  }
  const current = timeline?.conversation ?? conversation
  return <section className="team-conversation-pane">
    <header><div><strong>{current.side === 'team' ? current.visitor?.nickname : current.channel.name}</strong><small>{current.channel.name} · {current.side === 'team' ? tr("团队共同回复") : tr("仅你与团队可见")}</small></div><button onClick={() => { void refresh().then(onChanged) }}>{tr("刷新")}</button>
      {current.side === 'team' && current.channel.canManage && <button onClick={() => { void callArkme('team.app.block', { conversationRef: current.ref, blocked: !current.blocked }, ctrl.current.signal).then(() => refresh()).catch(e => { setError(errorText(e)) }) }}>{current.blocked ? tr("解除屏蔽") : tr("屏蔽此用户")}</button>}
    </header>
    {error && <div role="alert" className="team-error">{error}</div>}
    {current.side === 'external' && <p className="team-consultation-notice">{tr(current.channel.jotmoId === 'arkme_cn' ? "此对话由团队成员共同查看和回复；与作者的历史私聊仍保留在原会话。" : "此对话由团队成员共同查看和回复，仅你与团队可见。")}</p>}
    <div ref={scroller} className="team-message-list" aria-label={tr("团队消息记录")}>
      {timeline?.hasMore && <button onClick={() => { void refresh(timeline.beforeSeq) }}>{tr("加载更早消息")}</button>}
      {timeline?.messages.map(m => <article key={m.key} data-team-message-key={m.key} className={`team-message ${m.own ? 'is-own' : ''}`}>
        <TeamAvatar identity={m.sender} {...(m.side === 'team' ? { team: { nickname: current.channel.name, ...(current.channel.imageRef ? { imageRef: current.channel.imageRef } : {}) } } : {})} />
        <div className="team-message-body"><div className="team-message-meta"><strong>{m.sender.nickname}</strong>{m.side === 'team' && <span>· {current.channel.name}</span>}<time>{new Date(m.createdAt).toLocaleString()}</time></div>
          {m.state !== 'published' ? <p className="team-empty">{m.state === 'withdrawn' ? tr("这条消息已撤回") : tr("消息未发布")}</p> : m.contentStatus !== 'available' ? <p>{tr("内容当前不可用")}</p> : <><p className="team-message-text">{m.content?.text_content}</p>{m.media.map((f, index) => <TeamMessageAttachment key={`${m.key}:${m.version}:${index}`} media={f} signal={ctrl.current.signal} onError={setError} />)}</>}
          <div className="team-message-actions">{m.canEdit && current.channel.enabled && !current.blocked && <button onClick={() => { setEditing({ message: m, text: m.content?.text_content ?? '' }); setWithdraw(undefined) }}>{tr("编辑")}</button>}{m.canWithdraw && <button onClick={() => { setWithdraw(m); setEditing(undefined) }}>{tr("撤回")}</button>}{(current.side === 'team' || m.side === 'external') && <button onClick={() => { void readReceipts(m) }}>{tr("查看阅读状态")}</button>}</div>
        </div>
      </article>)}
      <div ref={bottom} className="team-read-sentinel" />
    </div>
    {receipt && <section className="team-receipts"><button onClick={() => { ++receiptGeneration.current; receiptRef.current = undefined; setReceipt(undefined) }}>{tr("关闭阅读状态")}</button><p>{current.side === 'external' ? receipt.value.teamRead ? tr("团队已查看") : tr("团队未查看") : receipt.value.visitorRead ? tr("用户已查看") : tr("用户未查看")}</p>{receipt.value.members.map((v, i) => <span key={i}>{v.nickname} · {v.read ? tr("已读") : tr("未读")} </span>)}{receipt.value.hasMore && <button onClick={() => { void readReceipts(receipt.message, true) }}>{tr("更多成员")}</button>}</section>}
    {(editing || withdraw) && <section className="team-edit"><p>{withdraw ? tr("只撤回当前团队会话中的消息引用，其他位置的引用保留。") : tr("修改会更新同一条快记，所有引用它的位置都会看到新内容。")}</p>{editing?.latestText !== undefined && <p>{tr("最新内容：")}{editing.latestText}{tr("。你的草稿已保留，确认修改将覆盖此版本。")}</p>}{editing && <textarea disabled={busy} aria-label={tr("修改消息内容")} value={editing.text} onChange={e => { setEditing({ ...editing, text: e.target.value }) }} />}{editing?.needsReload && <button disabled={busy} onClick={() => { void reloadEdit() }}>{tr("读取最新版本")}</button>}<button disabled={busy || editing?.needsReload} onClick={() => { void mutateMessage() }}>{editing?.latestText !== undefined ? tr("确认覆盖最新版本") : tr('确认{action}', { action: withdraw ? tr('撤回') : tr('修改') })}</button><button disabled={busy} onClick={() => { setEditing(undefined); setWithdraw(undefined) }}>{tr("取消")}</button></section>}
    <form className="team-composer" onSubmit={e => { e.preventDefault(); void send() }}>
      {(!current.channel.enabled || current.blocked) && <p>{current.blocked ? tr("此对话已被屏蔽，双方暂时不能发送或编辑消息") : tr("团队已暂停接收新消息")}</p>}
      <textarea aria-label={tr("团队消息内容")} placeholder={current.side === 'team' ? tr("代表团队回复…") : tr("发送消息…")} value={draft.text} disabled={!!draft.attempt || uploading} maxLength={20_000} onChange={e => { setDraft(v => ({ ...v, text: e.target.value })) }} />
      {draft.assets.map((v, i) => <span key={`${v.fileAssetUid}:${i}`}>{v.fileName}<button type="button" disabled={!!draft.attempt} onClick={() => { setDraft(d => ({ ...d, assets: d.assets.filter((_, index) => index !== i) })) }}>{tr("移除")}</button></span>)}
      <div className="team-compose-actions"><button className="team-attach-button" type="button" title={tr("添加附件")} aria-label={tr("添加附件")} disabled={!!draft.attempt || uploading || !current.channel.enabled || current.blocked} onClick={() => fileInput.current?.click()}><Paperclip size={20} aria-hidden /></button><input ref={fileInput} aria-label={tr("选择附件")} hidden type="file" multiple disabled={!!draft.attempt || uploading || !current.channel.enabled || current.blocked} onChange={e => { void upload(e.target.files); e.target.value = '' }} />{uploading && <span>{tr("正在上传…")}</span>}
        {draft.attempt?.reason === 'reply_conflict' ? <><button type="button" disabled={busy} onClick={() => { void send(true) }}>{tr("已读新回复，仍要发送")}</button><button type="button" disabled={busy} onClick={() => { void cancelAccepted() }}>{tr("取消本次发送，保留草稿")}</button></> : <button disabled={busy || uploading || !timeline || (!draft.text.trim() && !draft.assets.length) || (!draft.attempt && (!current.channel.enabled || current.blocked))}>{busy ? tr("处理中…") : draft.attempt ? tr("使用原请求重试") : tr("发送")}</button>}
      {draft.attempt?.message?.state === 'preparing' && draft.attempt.reason !== 'reply_conflict' && <button type="button" disabled={busy} onClick={() => { void cancelAccepted() }}>{tr("取消本次发送，保留草稿")}</button>}
      </div>
    </form>
  </section>
}

export function TeamChannelSettings({ teamRef, accountKey, onChanged }: { teamRef: string; accountKey: string; onChanged(): void }) {
  useArkmeLocale()
  const [channel, setChannel] = useState<TeamChannel>(), [applications, setApplications] = useState<TeamPage<TeamApplication>>()
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ label: string; run(): Promise<unknown> }>()
  const ctrl = useRef(new AbortController()), generation = useRef(0)
  useEffect(() => () => { ctrl.current.abort() }, [])
  const loaded = useRef({applications}); loaded.current={applications}
  const loadApplications = async (cursor?: string, token = generation.current) => {
    let page = await callArkme<TeamPage<TeamApplication>>('team.app.applications',{teamRef,...(cursor?{cursor}:{})},ctrl.current.signal)
    const previous=loaded.current.applications,items=[...(cursor?previous?.items??[]:[]),...page.items],seen=new Set<string>()
    while(!cursor && items.length<(previous?.items.length??0) && page.hasMore) {
      if(!page.nextCursor || seen.has(page.nextCursor)) throw new Error(tr('消息分页异常，请重试'))
      seen.add(page.nextCursor)
      if(ctrl.current.signal.aborted || token!==generation.current)return
      page=await callArkme<TeamPage<TeamApplication>>('team.app.applications',{teamRef,cursor:page.nextCursor},ctrl.current.signal);items.push(...page.items)
    }
    if(!ctrl.current.signal.aborted && token===generation.current) setApplications({...page,items})
  }
  const refresh = async () => {
    const token = ++generation.current
    try {
      const data = await callArkme<TeamChannel>('team.app.channel', {teamRef}, ctrl.current.signal)
      if (ctrl.current.signal.aborted || token !== generation.current) return
      setChannel(data)
      if (ctrl.current.signal.aborted || token !== generation.current) return
      if(data.canManage) await loadApplications(undefined,token)
      else setApplications(undefined)
      if (!ctrl.current.signal.aborted && token===generation.current) setError('')
    } catch (e) { if (!ctrl.current.signal.aborted && token===generation.current) {setError(errorText(e)); if(inaccessible(e)){setChannel(undefined);setApplications(undefined)}} }
  }
  useEffect(() => { void refresh(); return subscribeTeamMessageChanges(account => { if (account === accountKey) void refresh() }) }, [teamRef, accountKey])
  const mutate = async (run: () => Promise<unknown>) => { setBusy(true); try { await run(); if (ctrl.current.signal.aborted) return; setConfirm(undefined); await refresh(); onChanged() } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) } finally { if (!ctrl.current.signal.aborted) setBusy(false) } }
  const configure = (enabled: boolean, rotate = false) => callArkme('team.app.channel.configure', { teamRef, revision: channel?.revision ?? 0, enabled, rotate }, ctrl.current.signal)
  return <section className="team-settings"><header className="team-settings-header"><h2>{tr("团队消息通道")}</h2><button disabled={busy} onClick={() => { void refresh() }}>{tr("刷新通道与申请")}</button></header>{error && <p role="alert" className="team-error">{error}</p>}
    <p>{tr("通道中的每位用户都有独立会话。团队成员可共同查看和回复，用户无法查看团队成员列表。")}</p>
    {channel?.publicRef && <><p>{channel.enabled ? tr("正在接收消息") : tr("已暂停接收新消息")}</p><input aria-label={tr("团队消息分享链接")} readOnly value={channel.link} /><button onClick={() => { void navigator.clipboard.writeText(channel.link).then(() => { setNotice(tr("通道链接已复制")) }).catch(() => { setNotice(tr("复制失败，请手动复制链接")) }) }}>{tr("复制通道链接")}</button></>}
    {channel?.canManage && <div><button disabled={busy} onClick={() => { if (!channel.publicRef) setConfirm({ label: tr("建立通道后，现有成员均可查看全部团队对话。请核对团队成员名单；此后新成员须经所有者审批。确认建立？"), run: () => configure(true) }); else void mutate(() => configure(!channel.enabled)) }}>{!channel.publicRef ? tr("建立团队消息通道") : channel.enabled ? tr("暂停通道") : tr("开启通道")}</button>{channel.publicRef && <button disabled={busy} onClick={() => { setConfirm({ label: tr("重置后旧链接失效，已存在的会话继续保留。确认重置？"), run: () => configure(channel.enabled, true) }) }}>{tr("重置分享链接")}</button>}</div>}
    <p role="status">{notice}</p>
    {channel?.canManage && <><h3>{tr("加入申请")}</h3>{applications?.items.length === 0 && <p>{tr("没有待处理申请")}</p>}{applications?.items.map(a => <div className="team-member-row" key={a.ref}><span>{a.name} · {new Date(a.requestedAt).toLocaleString()}</span>{a.state === 'pending' && <><button disabled={busy} onClick={() => { setConfirm({ label: tr('同意 {name} 加入后，对方可查看全部团队对话历史并代表团队回复。确认同意？', { name: a.name }), run: () => callArkme('team.app.application.decide', { applicationRef: a.ref, approve: true }, ctrl.current.signal) }) }}>{tr("同意")}</button><button disabled={busy} onClick={() => { void mutate(() => callArkme('team.app.application.decide', { applicationRef: a.ref, approve: false }, ctrl.current.signal)) }}>{tr("拒绝")}</button></>}</div>)}{applications?.hasMore && <button onClick={() => { void loadApplications(applications.nextCursor,++generation.current).catch(e => { setError(errorText(e)) }) }}>{tr("更多申请")}</button>}</>}
    {confirm && <div className="team-confirm" role="alert"><p>{confirm.label}</p><button disabled={busy} onClick={() => { void mutate(confirm.run) }}>{tr("确认")}</button><button disabled={busy} onClick={() => { setConfirm(undefined) }}>{tr("取消")}</button></div>}
  </section>
}
