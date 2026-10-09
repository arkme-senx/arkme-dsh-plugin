import { teamTaskShowsInlineStatus, useTeamSendTasks } from './team-send-tasks.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ArkmeSendTaskStatus } from './ArkmeSendTaskStatus.js'
import type { TeamSendTask } from '../team-send-contract.js'
import { ConfirmedSendRetentionOwner } from './confirmed-send-retention.js'
import { ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS } from './conversation-memory-cache.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeTopicTagBadge } from './ArkmeTopicTagBadge.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { arkmeConversationAnchorOffset, arkmeConversationViewport } from './conversation-viewport.js'
import { arkmeConversationRestoredScrollTop, type ArkmeConversationViewportSnapshot } from './conversation-memory-cache.js'
import { ArkmeComposerTargetPreview } from './ArkmeComposerTargetPreview.js'
import { Toast, IconCheckOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { conversationDirectoryStyles as directoryStyles, conversationTimeLabel } from './conversation-directory-presentation.js'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { Paperclip } from '@phosphor-icons/react/dist/icons/Paperclip'
import { startTeamDirectory, subscribeTeamDirectory, readTeamDirectory, refreshTeamDirectory, discardTeamDirectory } from './team-conversation-directory.js'
import { startTeamAttention } from './team-attention-store.js'
import { showBrowserNotification } from './browser-notification.js'
import { teamText as tr } from './team-messaging-i18n.js'
import { useArkmeLocale } from './locale.js'
import { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { callArkme } from './api.js'
import { createArkmeSdk } from '../sdk/index.js'
import type { ArkmeUploadedAsset } from '../types.js'
import type { TeamApplication, TeamChannel, TeamContent, TeamConversation, TeamIdentity, TeamMessage, TeamOpen, TeamPage, TeamReceipts, TeamTimeline } from '../team-app-contract.js'
import { openTeamMessages, subscribeTeamMessageChanges, type TeamMessageIntent } from './team-messaging-events.js'
import { loadTeamDraft, persistTeamDraft, type TeamDraft as Draft } from './team-message-draft.js'
import { TeamConversationMessage } from './TeamConversationMessage.js'
import { arkmeConversationMessageLayout as messageLayout, dayKey, dayLabel } from './conversation-message-presentation.js'
import { arkmeConversationComposerLayout as composerLayout, arkmeConversationComposerBorder } from './conversation-composer-presentation.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from './ArkmeRichComposerInput.js'
import { ArkmeComposerSendButton } from './ArkmeComposerSendButton.js'
import { ArkmeComposerToolButton } from './ArkmeComposerToolButton.js'
import { ArkmeAttachmentDraftTile } from './ArkmeRichContent.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { Fragment } from 'react'
import { ArkmeReadReceiptMember, ArkmeReadReceiptPanel, ArkmeReadReceiptStatus } from './ArkmeReadReceiptPanel.js'

import { ArkmeComposerPlusIcon } from './ArkmeComposerToolIcon.js'
import { ArkmeEmojiPicker } from './ArkmeEmojiPicker.js'
import { ArkmeComposerScreenshotButton } from './ArkmeComposerScreenshotButton.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { arkmeComposerPlaceholderText } from './composer-placeholder.js'
import { useResizableComposer } from './use-resizable-composer.js'
import { focusArkmeComposerFromClick } from './composer-focus.js'
import { useComposerPasteFocus } from './composer-paste-focus.js'
import type { ArkmeComposerSelectionRequest } from './composer-selection-request.js'
import { arkmeComposerDraftFromText, insertArkmeComposerEmoji, reconcileArkmeComposerEmojis, serializeArkmeComposerDraft } from './composer-draft-store.js'


function errorText(error: unknown): string { return error instanceof Error ? tr(error.message) : tr("操作失败，请重试") }
function inaccessible(error: unknown): boolean { return /team-(not_accessible|account-changed)|login-/.test(String((error as { body?: { code?: string } })?.body?.code)) }

// The accepted command is immutable; text typed afterwards belongs to the next draft.
function pendingTeamMessage(draft: Draft, conversation: TeamConversation, media: Map<string, string>, sender?: TeamIdentity): TeamMessage | undefined {
  const attempt = draft.attempt
  if (!attempt) return undefined
  return {
    key: attempt.uid, ref: '', seq: 0, revision: 0, side: conversation.side,
    sender: sender ?? { nickname: '' }, own: true, state: 'sending',
    createdAt: attempt.createdAt ?? Date.now(), canEdit: false, canDelete: false, version: 0,
    contentStatus: 'available', content: attempt.content,
    media: [...draft.assets.map(asset => ({
      ref: asset.fileAssetUid, key: asset.fileAssetUid, url: media.get(asset.fileAssetUid) ?? '',
      name: asset.fileName, mimeType: asset.mimeType, size: asset.size, kind: asset.fileKind,
    })), ...(draft.localFiles ?? []).map(file => ({ ref: file.fileRef, key: file.fileRef, url: createArkmeSdk().localFileUrl(file.fileRef), name: file.fileName, mimeType: file.mimeType, size: file.size, kind: file.fileKind }))],
  }
}

function restoreTeamDraftText(original: string, next: string): string {
  return !original ? next : !next || next === original ? original : `${original}\n\n${next}`
}

export function TeamAvatar({ identity, size }: { identity: TeamIdentity; size?: number }) {
  return <ArkmeUserAvatar avatarRef={identity.imageRef} imageKey={identity.imageKey}
    imagePort={teamAvatarImages} size={size ?? 32} label={identity.nickname} />
}

export function TeamConversationRow({ conversation: c, selected = false, showTeamName = true, role, onClick }: {
  conversation: TeamConversation; selected?: boolean; showTeamName?: boolean; role?: 'treeitem'; onClick(): void
}) {
  const preview = c.preview?.status === 'available'
    ? c.preview.text || (c.preview.templateKind === 3 ? tr('[语音]') : c.preview.hasMedia ? tr('[附件]') : '')
    : c.preview ? tr('内容暂不可用') : ''
  return <button className="team-conversation-row" data-team-side={c.side} type="button" role={role}
    {...(role === 'treeitem' ? { 'aria-selected': selected } : {})} data-arkme-feedback="neutral"
    style={{ ...directoryStyles.chatRow, ...(selected ? { background: arkmeTheme.active } : {}) }} onClick={onClick}>
    <span style={directoryStyles.sourceAvatarWrap}>
      <TeamAvatar size={directoryStyles.sourceAvatarWrap.width} identity={c.side === 'team' ? c.visitor ?? { nickname: tr('用户') } : { ...c.channel, nickname: c.channel.name }} />
      {c.unread > 0 && <span style={directoryStyles.mentionUnread}>{c.unread > 99 ? '99+' : c.unread}</span>}
    </span>
    <span data-arkme-conversation-content style={directoryStyles.chatContent}>
      <span style={directoryStyles.chatTop}>
        <span style={directoryStyles.entryName}>{c.side === 'team' ? c.visitor?.nickname ?? tr('用户') : c.channel.name}</span>
        <ArkmeTopicTagBadge label={c.side === 'team' ? `${showTeamName ? `${c.channel.name} · ` : ''}${tr('外部用户')}` : c.channel.name} selected={selected} truncate />
        <span style={{ ...directoryStyles.chatTime, marginLeft: 'auto' }}>{conversationTimeLabel(c.updatedAt)}</span>
      </span>
      <span style={directoryStyles.chatBottom}><span style={directoryStyles.preview}><ArkmeRichText text={preview} presentation="preview" emojiSize={20} /></span></span>
    </span>
  </button>
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
  const [openInbox, setOpenInbox] = useState(false)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setSelected(undefined); setChannel(undefined); setOpenInbox(false); setError(''); setLoading(true)
    const run = async () => {
      if (intent.kind === 'conversation') { setSelected(intent.conversation); return }
      if (intent.kind === 'inbox') { await refreshTeamDirectory(accountKey); return }
      if (intent.kind === 'team') {
        const value = await callArkme<TeamChannel>('team.app.channel', { teamRef: intent.teamRef }, controller.signal)
        if (!controller.signal.aborted) setChannel(value)
        await refreshTeamDirectory(accountKey)
        return
      }
      const publicRef = intent.kind === 'official'
        ? (await callArkme<TeamChannel>('team.app.official', { expectedAccountKey: accountKey }, controller.signal)).publicRef : intent.publicRef
      const value = await callArkme<TeamOpen>('team.app.open', { publicRef, expectedAccountKey: accountKey }, controller.signal)
      if (controller.signal.aborted) return
      setChannel(value.channel)
      if (value.conversation) setSelected(value.conversation)
      else if (value.openInbox === true) setOpenInbox(true)
      else throw new Error(tr('暂时无法打开对话，请重试'))
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
  const directoryAllowed = intent.kind === 'inbox' || intent.kind === 'team' || openInbox
  const items = (directoryAllowed ? directory.items : []).filter(c => channel ? c.side === 'team' && c.channel.jotmoId === channel.jotmoId : intent.kind !== 'inbox' || !intent.side || c.side === intent.side)
  return <section className="team-message-panel" aria-label={tr('团队对话')}>
    <header style={messageLayout.header}><div style={messageLayout.titleBlock}><strong style={messageLayout.title}>{channel?.name ?? tr(intent.kind === 'official' ? '联系作者' : '团队对话')}</strong>{channel && <small style={messageLayout.headerSubtitle}>{tr('团队对话')}</small>}</div></header>
    {loading ? <div className="team-empty" role="status">{tr('正在打开对话…')}</div>
      : error ? <div className="team-opening-error" role="alert"><p>{error}</p><button onClick={() => { setAttempt(v => v + 1) }}>{tr('重试')}</button></div>
      : <div className="team-conversation-directory">
        {directory.error && <div className="team-opening-error" role="alert"><p>{tr(directory.error)}</p><button disabled={directory.loading} onClick={() => { void refreshTeamDirectory(accountKey) }}>{tr('重试')}</button></div>}
        <div role="list" aria-label={tr('团队对话')}>{items.map(c => <div role="listitem" key={`${c.side}:${c.key}`}><TeamConversationRow conversation={c} showTeamName={!channel}
          onClick={() => { openTeamMessages({ kind: 'conversation', conversation: c }) }} /></div>)}</div>
        {items.length === 0 && !directory.error && <p className="team-empty" role={directory.loading ? 'status' : undefined}>{tr(directory.loading ? '正在打开对话…' : '还没有团队对话')}</p>}
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
  const [composerFocused, setComposerFocused] = useState(false)
  const delivery = useTeamSendTasks(conversation.ref, accountKey)
  const storageKey = `arkme.team.draft:${accountKey}:${conversation.key}`
  const [draft, setDraft] = useState<Draft>(() => loadTeamDraft(localStorage, storageKey)), [timeline, setTimeline] = useState<TeamTimeline>()
  const [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false)
  const [outgoing, setOutgoing] = useState<TeamMessage | undefined>(() => pendingTeamMessage(draft, conversation, new Map()))
  const localMedia = useRef(new Map<string, string>())
  useEffect(() => () => {
    for (const url of localMedia.current.values()) URL.revokeObjectURL(url)
  }, [])
  useEffect(() => {
    // Retain upload previews only while the draft or a local message uses them.
    // Authorized, versioned media takes over after publication.
    const active = new Set([
      ...draft.assets.map(asset => asset.fileAssetUid),
      ...(outgoing?.media ?? []).map(asset => asset.key),
      ...(timeline?.messages ?? []).flatMap(message => message.media
        .filter(asset => asset.url.startsWith('blob:')).map(asset => asset.key)),
    ])
    for (const [key, url] of localMedia.current) {
      if (!active.has(key)) { URL.revokeObjectURL(url); localMedia.current.delete(key) }
    }
  }, [draft.assets, outgoing, timeline])
  const confirmed = useRef(new ConfirmedSendRetentionOwner<TeamMessage>({
    maxItems: 64,
    ttlMillis: ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS * 4,
    key: message => message.key,
    canRetain: message => message.own && message.state === 'published',
    isAuthoritative: message => message.version > 0 || message.contentStatus === 'deleted',
    merge: (local, remote) => [...new Map([...local, ...remote].map(message => [message.key, message])).values()]
      .sort((a, b) => a.seq - b.seq),
  }))
  const [receipt, setReceipt] = useState<{ message: TeamMessage; value?: TeamReceipts; error?: string }>()
  const [editing, setEditing] = useState<{ message: TeamMessage; text: string; needsReload?: boolean; latestText?: string }>(), [deleting, setDeleting] = useState<TeamMessage>()
  const ctrl = useRef(new AbortController()), generation = useRef(0), bottom = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), visible = useRef(false), read = useRef(conversation.myReadSeq)
  const fileInput = useRef<HTMLInputElement>(null)
  const editor = useRef<ArkmeRichComposerHandle>(null), composer = useRef<HTMLDivElement>(null)
  const addTrigger = useRef<HTMLButtonElement>(null), [addOpen, setAddOpen] = useState(false)
  const [selectionRequest, setSelectionRequest] = useState<ArkmeComposerSelectionRequest>()
  const composerScope = useMemo(() => ({}), [accountKey, conversation.key, editing?.message.key])
  const currentScope = useRef(composerScope); currentScope.current = composerScope
  const resize = useResizableComposer(composer, `${storageKey}:${editing?.message.key ?? ''}`, scroller)
  const beginPasteFocus = useComposerPasteFocus({ scope: composerScope, active: !editing, editor, container: composer, onReady: setSelectionRequest })
  const richDraft = arkmeComposerDraftFromText(editing?.text ?? draft.text)
  const updateText = (text: string) => {
    if (editing) setEditing({ ...editing, text })
    else { const next = { ...draftRef.current, text }; draftRef.current = next; setDraft(next) }
  }
  const editorSelection = useRef({start:0,end:0})
  const captureSelection = () => { if (editor.current) editorSelection.current = {start:editor.current.selectionStart,end:editor.current.selectionEnd} }
  useEffect(() => { setAddOpen(false); setSelectionRequest(undefined) }, [composerScope])
  const viewport = useRef<ArkmeConversationViewportSnapshot>()
  const sendBusy = useRef(false), receiptsBusy = useRef(false)
  const latest = useRef(timeline); latest.current = timeline
  const draftRef = useRef(draft); draftRef.current = draft
  const resumeSend = useRef<() => Promise<void>>(async () => {})
  const recovering = useRef(false), recoverAgain = useRef(false)
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost
  useEffect(() => { try { persistTeamDraft(localStorage, storageKey, draft) } catch { setError(tr("草稿未能保存到本机，请勿关闭窗口")) } }, [storageKey, draft])
  useEffect(() => () => { ctrl.current.abort() }, [])
  const receiptRef = useRef(receipt); receiptRef.current = receipt
  const receiptGeneration = useRef(0)
  const receiptAnchor = useRef<HTMLElement | null>(null)
  const readReceipts = useCallback(async (message: TeamMessage, more = false) => {
    const previous = receiptRef.current?.message.key === message.key ? receiptRef.current : undefined
    if (receiptsBusy.current && previous) return
    receiptsBusy.current = true
    const token = ++receiptGeneration.current
    const opening = { message, ...(previous?.value ? { value: previous.value } : {}) }
    receiptRef.current = opening; setReceipt(opening)
    try {
      let value = await callArkme<TeamReceipts>('team.app.receipts', { messageRef: message.ref, ...(more ? { cursor: previous?.value?.nextCursor } : {}) }, ctrl.current.signal)
      const members = [...(more ? previous?.value?.members ?? [] : []), ...value.members], seen = new Set<string>()
      while (!more && members.length < (previous?.value?.members.length ?? 0) && value.hasMore) {
        if (!value.nextCursor || seen.has(value.nextCursor)) throw new Error(tr('消息分页异常，请重试'))
        seen.add(value.nextCursor)
        if (ctrl.current.signal.aborted || token !== receiptGeneration.current) return
        value = await callArkme<TeamReceipts>('team.app.receipts', { messageRef: message.ref, cursor: value.nextCursor }, ctrl.current.signal)
        members.push(...value.members)
      }
      if (!ctrl.current.signal.aborted && token === receiptGeneration.current) { const next = { message, value: { ...value, members } }; receiptRef.current = next; setReceipt(next) }
    } catch (e) {
      if (!ctrl.current.signal.aborted && token === receiptGeneration.current) {
        const failed = { ...opening, error: errorText(e) }; receiptRef.current = failed; setReceipt(failed)
      }
    } finally { if (token === receiptGeneration.current) receiptsBusy.current = false }
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
      if (ctrl.current.signal.aborted || token !== generation.current) return
      data = { ...data, conversation: head, messages: confirmed.current.merge(conversation.key, [...messages.values()].sort((a,b) => a.seq-b.seq)) }
      if (scroller.current && old) viewport.current = arkmeConversationViewport(scroller.current)
      latest.current = data
      setTimeline(data)
      setLoadError('')
      if (receiptRef.current) await readReceipts(receiptRef.current.message)
      if (beforeSeq && head.lastSeq > (data.messages.at(-1)?.seq ?? 0)) void refresh()
      return data
    } catch (e) { if (!ctrl.current.signal.aborted && token === generation.current) { setLoadError(errorText(e)); if (inaccessible(e)) { accessLost.current?.(); confirmed.current.clear(); setOutgoing(undefined); setTimeline(undefined); ++receiptGeneration.current; receiptsBusy.current = false; receiptRef.current = undefined; setReceipt(undefined); setEditing(undefined) } } }
  }, [conversation.ref, readReceipts])
  const recover = useCallback(async () => {
    if (ctrl.current.signal.aborted) return
    if (recovering.current) { recoverAgain.current = true; return }
    recovering.current = true
    try {
      do {
        recoverAgain.current = false
        delivery.refresh()
        const fresh = await refresh()
        const attempt = draftRef.current.attempt
        if (fresh && attempt && fresh.conversation.channel.enabled && !fresh.conversation.blocked
          && ['', 'network_unavailable', 'dependency_unavailable', 'preparing', 'reply_conflict'].includes(attempt.reason ?? '')) {
          await resumeSend.current()
        }
      } while (recoverAgain.current && !ctrl.current.signal.aborted)
    } finally { recovering.current = false }
  }, [refresh])
  useEffect(() => { void recover(); return subscribeTeamMessageChanges(account => { if (account === accountKey) { void recover() } }) }, [recover, accountKey])
  useEffect(() => {
    const recoverOnline = () => { void recover() }
    window.addEventListener('focus', recoverOnline)
    window.addEventListener('online', recoverOnline)
    return () => { window.removeEventListener('focus', recoverOnline); window.removeEventListener('online', recoverOnline) }
  }, [recover])
  // Same before-paint scroll restoration as ordinary conversation previews.
  // A refresh must never paint at the wrong position then jump on the next frame.
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node || !timeline) return
    const offset = arkmeConversationAnchorOffset(node, viewport.current?.anchorId)
    node.scrollTop = arkmeConversationRestoredScrollTop(viewport.current, {
      currentScrollTop: node.scrollTop, scrollHeight: node.scrollHeight,
      ...(offset === undefined ? {} : { anchorOffset: offset }),
    })
    viewport.current = arkmeConversationViewport(node)
  }, [timeline, outgoing, delivery.tasks])
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
  const observedCompletions = useRef(new Set<string>())
  useLayoutEffect(() => {
    let changed = false
    for (const task of delivery.tasks) {
      if (task.state !== 'sent' || !task.message || observedCompletions.current.has(task.taskRef)) continue
      observedCompletions.current.add(task.taskRef)
      changed = true
      if (Date.now() - (task.completedAtMillis ?? task.createdAtMillis) > ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS * 4) continue
      confirmed.current.retain(conversation.key, { ...task.message, content: task.message.content ?? task.sendContent ?? task.content, contentStatus: task.message.contentStatus || 'available',
        media: task.message.contentStatus ? task.message.media : task.files.map(file => ({ref:file.fileRef,key:file.fileRef,url:createArkmeSdk().localFileUrl(file.fileRef),name:file.fileName,mimeType:file.mimeType,size:file.size,kind:file.fileKind})) })
    }
    if (changed) {
      const old = latest.current
      if (old) {
        const next = { ...old, messages: confirmed.current.merge(conversation.key, old.messages) }
        latest.current = next; setTimeline(next)
      }
      void refresh(); onChanged()
    }
  }, [delivery.tasks, conversation.key, refresh, onChanged])
  const send = async () => {
    const timeline = latest.current, draft = draftRef.current
    if (!timeline || sendBusy.current || uploading || busy) return
    if (!draft.attempt && ((!draft.text.trim() && !draft.assets.length && !draft.localFiles?.length) || !timeline.conversation.channel.enabled || timeline.conversation.blocked)) return
    const attempt = draft.attempt ?? { uid: crypto.randomUUID(), createdAt: Date.now(), content: teamDraftContent(draft), expectedReplySeq: timeline.conversation.latestTeamReplySeq, fileRefs: (draft.localFiles ?? []).map(file => file.fileRef) }
    const acceptedDraft = { ...draft, text: draft.attempt ? draft.text : '', attempt }
    try { persistTeamDraft(localStorage, storageKey, acceptedDraft) } catch { setError(tr('无法保存发送请求，请释放本机存储后再发送')); return }
    sendBusy.current = true; draftRef.current = acceptedDraft; setDraft(acceptedDraft); setBusy(true); setError('')
    setOutgoing(outgoing ?? pendingTeamMessage(acceptedDraft, conversation, localMedia.current, timeline.messages.findLast(m => m.own)?.sender))
    try {
      const task = await callArkme<TeamSendTask>('team.app.send.enqueue', { conversationRef: conversation.ref, clientUid: attempt.uid, content: attempt.content, expectedReplySeq: attempt.expectedReplySeq, fileRefs: attempt.fileRefs ?? [] }, ctrl.current.signal)
      if (ctrl.current.signal.aborted) return
      if (task?.clientUid !== attempt.uid || !task.taskRef || !Array.isArray(task.files)) throw new Error(tr('发送状态暂时无法确认，请重试'))
      delivery.accept(task)
      const next = { text: draftRef.current.text, assets: [] }
      // Host admission is durable even if browser draft cleanup fails. The old
      // on-disk attempt keeps its UID so a remount can only replay the same send.
      try { persistTeamDraft(localStorage, storageKey, next) }
      catch { setError(tr('消息已加入发送队列，草稿未能更新到本机')) }
      draftRef.current = next; setDraft(next); setOutgoing(undefined)
    } catch (e) {
      if (!ctrl.current.signal.aborted) {
        setError(errorText(e))
        const code = (e as { body?: { code?: string } })?.body?.code
        const failed = {...draftRef.current, attempt:{...attempt, reason:code === 'local-network-unavailable' ? 'network_unavailable' : code?.replace(/^team-/, '') ?? 'network_unavailable'}}
        try { persistTeamDraft(localStorage, storageKey, failed); draftRef.current = failed; setDraft(failed) }
        catch { setError(tr('草稿未能保存到本机，请勿关闭窗口')); return }
        // Lost local acceptance is retried with the same identity. Do not turn it into a second send.
        if (['team-invalid_request', 'team-queue-full', 'file-local-missing', 'team-channel_paused', 'team-conversation_blocked'].includes(code ?? '')) {
          const kept = { text: restoreTeamDraftText(attempt.content.text_content, draftRef.current.text), assets: draft.assets, ...(draft.localFiles ? {localFiles:draft.localFiles} : {}) }
          try { persistTeamDraft(localStorage, storageKey, kept); draftRef.current = kept; setDraft(kept); setOutgoing(undefined) }
          catch { setError(tr('草稿未能保存到本机，请勿关闭窗口')) }
        }
      }
    } finally { sendBusy.current = false; if (!ctrl.current.signal.aborted) setBusy(false) }
  }
  resumeSend.current = send
  const upload = async (files: FileList | readonly File[] | null) => {
    if (!files || editing || busy || uploading || draft.attempt || !latest.current?.conversation.channel.enabled || latest.current.conversation.blocked) return
    // The file picker is reset synchronously after onChange; retain its selection
    // before awaiting capabilities, just as the ordinary Chat composer does.
    const picked = Array.from(files)
    setUploading(true)
    try {
      const sdk = createArkmeSdk(), policy = await sdk.fileCapabilities()
      const userId = Number(accountKey.split(':').at(-1))
      for (const file of picked) {
        if (draftRef.current.assets.length + (draftRef.current.localFiles?.length ?? 0) >= policy.maxAttachments) throw new Error(tr('最多添加 9 个附件'))
        const local = await sdk.stageFile(file, { signal: ctrl.current.signal, ...(userId > 0 ? {expectedUserId:userId} : {}) })
        if (ctrl.current.signal.aborted) return
        const next = { ...draftRef.current, localFiles: [...(draftRef.current.localFiles ?? []), local] }
        persistTeamDraft(localStorage, storageKey, next); draftRef.current = next; setDraft(next)
      }
    } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) }
    finally { if (!ctrl.current.signal.aborted) setUploading(false) }
  }
  const actOnTask = async (task: TeamSendTask, action: 'retry' | 'cancel') => {
    try {
      const result = await callArkme<TeamSendTask>(action === 'cancel' ? 'team.app.send.cancel-task' : 'team.app.send.retry-task', {
        conversationRef: conversation.ref, taskRef: task.taskRef,
      }, ctrl.current.signal)
      if (!ctrl.current.signal.aborted) { delivery.accept(result); setError('') }
    } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) }
  }
  const mutateMessage = async () => {
    if (busy || editing?.needsReload || (editing && (!latest.current?.conversation.channel.enabled || latest.current.conversation.blocked || (!editing.text.trim() && !editing.message.media.length)))) return
    setBusy(true)
    try {
      if (deleting) await callArkme('team.app.delete', { messageRef: deleting.ref, version:deleting.version }, ctrl.current.signal)
      else if (editing?.message.content) await callArkme('team.app.edit', { messageRef: editing.message.ref, version: editing.message.version, content: { ...editing.message.content, text_content: editing.text } }, ctrl.current.signal)
      setDeleting(undefined); setEditing(undefined); await refresh(); onChanged()
    } catch (e) {
      if (!ctrl.current.signal.aborted) {
        setError(errorText(e))
        if ((e as { body?: { code?: string } })?.body?.code === 'team-version_conflict') setEditing(v => v ? { ...v, needsReload: true } : v)
        if (deleting) {
          await refresh()
          const current = latest.current?.messages.find(m => m.key === deleting.key)
          if (!current || current.contentStatus === 'deleted') setDeleting(undefined)
          else if (current.version !== deleting.version) {setDeleting(current);setError(tr('内容已更新，请确认是否删除最新内容'))}
        }
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
  const taskRows = delivery.tasks.filter(task => !['sent', 'cancelled'].includes(task.state))
  const visibleMessages = [...(timeline?.messages ?? [])]
  for (const task of taskRows) {
    if (visibleMessages.some(message => message.key === task.message?.key)) continue
    visibleMessages.push({
      key: task.message?.key ?? task.clientUid, ref: task.message?.ref ?? '', seq: 0, revision: 0,
      side: conversation.side, sender: timeline?.messages.findLast(message => message.own)?.sender ?? {nickname:''},
      own: true, state: 'sending', createdAt: task.createdAtMillis, canEdit:false, canDelete:false, version:0,
      contentStatus:'available', content:task.sendContent ?? task.content,
      media: task.files.map(file => ({ref:file.fileRef,key:file.fileRef,url:createArkmeSdk().localFileUrl(file.fileRef),name:file.fileName,mimeType:file.mimeType,size:file.size,kind:file.fileKind})),
    })
  }
  if (outgoing && !taskRows.some(task => task.clientUid === outgoing.key)) visibleMessages.push(outgoing)
  const current = timeline?.conversation ?? conversation
  return <section className="team-conversation-pane">
    <header style={messageLayout.header}>
      {current.side === 'team' && <ArkmeComposerToolButton aria-label={tr('返回团队对话')} title={tr('返回团队对话')}
        onClick={() => openTeamMessages({ kind: 'team', teamRef: current.channel.teamRef })}><ArrowLeft size={20} aria-hidden /></ArkmeComposerToolButton>}
      <div style={messageLayout.titleGroup}><div style={messageLayout.titleBlock}><strong style={messageLayout.title}>{current.side === 'team' ? current.visitor?.nickname : current.channel.name}</strong><small style={messageLayout.headerSubtitle}>{current.side === 'team' ? `${current.channel.name} · ${tr('外部用户')}` : tr('团队对话')}</small></div></div>
    </header>
    {loadError && <div role="alert" className="team-error">{loadError} <button type="button" onClick={() => { void recover() }}>{tr('重试')}</button></div>}
    {error && <div role="alert" className="team-error">{error}</div>}
    <div ref={scroller} className="team-message-list" onScroll={() => { if (scroller.current) viewport.current = arkmeConversationViewport(scroller.current) }} aria-label={tr("团队消息记录")}>
      {timeline?.hasMore && <button onClick={() => { void refresh(timeline.beforeSeq) }}>{tr("加载更早消息")}</button>}
      {visibleMessages.map((m, index) => <Fragment key={delivery.tasks.find(task => task.message?.key === m.key)?.clientUid ?? m.key}>
        {(index === 0 || dayKey(m.createdAt) !== dayKey(visibleMessages[index - 1]!.createdAt)) && <div style={{ ...messageLayout.date, textAlign: 'center' }}>{dayLabel(m.createdAt)}</div>}
        <TeamConversationMessage message={m} avatar={<TeamAvatar identity={m.sender} size={messageLayout.messageAvatar.width as number} />} writable={current.channel.enabled && !current.blocked}
          showReceipts={current.side === 'team'} busy={busy}
          onEdit={() => { setError(''); setEditing({ message: m, text: m.content?.text_content ?? '' }); setDeleting(undefined) }}
          onDelete={() => { setError(''); setDeleting(m); setEditing(undefined) }}
          onReceipts={anchor => { if (receiptRef.current?.message.key === m.key) { ++receiptGeneration.current; receiptsBusy.current = false; receiptRef.current = undefined; setReceipt(undefined) } else { receiptAnchor.current = anchor; void readReceipts(m) } }} onError={setError} />
        {taskRows.filter(task => (task.message?.key ?? task.clientUid) === m.key && teamTaskShowsInlineStatus(task)).map(task => <ArkmeSendTaskStatus label={tr('发送状态')} key={task.taskRef} own state={task.state}>
          {tr(task.cancelRequested ? '正在取消…' : task.state === 'failed' ? task.error ?? '发送失败' : task.state === 'retrying' || task.state === 'queued' ? '等待发送' : task.state === 'uploading' ? '正在上传…' : '正在发送…')}
          {(task.state === 'failed' && task.cancelRequested) && <button type="button" data-arkme-feedback="neutral" onClick={() => {void actOnTask(task,'retry')}}>{tr('重试')}</button>}
          {!task.cancelRequested && task.state === 'failed' && <button type="button" data-arkme-feedback="neutral" onClick={() => {void actOnTask(task,'cancel')}}>{tr('取消发送')}</button>}
        </ArkmeSendTaskStatus>)}
      </Fragment>)}
      <div ref={bottom} className="team-read-sentinel" />
    </div>
    {receipt && <ArkmeReadReceiptPanel anchor={receiptAnchor.current} label={tr('查看阅读状态')}
      onClose={() => { ++receiptGeneration.current; receiptsBusy.current = false; receiptRef.current = undefined; setReceipt(undefined) }}>
      {!receipt.value && !receipt.error && <ArkmeReadReceiptStatus>{tr('加载中...')}</ArkmeReadReceiptStatus>}
      {receipt.error && <ArkmeReadReceiptStatus onClick={() => { void readReceipts(receipt.message) }}>{tr('加载失败')}</ArkmeReadReceiptStatus>}
      {receipt.value && <ArkmeReadReceiptStatus>{current.side === 'external' ? receipt.value?.teamRead ? tr('团队已查看') : tr('团队未查看') : receipt.value?.visitorRead ? tr('用户已查看') : tr('用户未查看')}</ArkmeReadReceiptStatus>}
      {receipt.value?.members.map((v, i) => <ArkmeReadReceiptMember key={i} name={v.nickname || tr('用户')} read={v.read} readAt={v.readAt} avatar={<TeamAvatar identity={v} size={20} />} />)}
      {receipt.value?.hasMore && <ArkmeReadReceiptStatus onClick={() => { void readReceipts(receipt.message, true) }}>{tr('更多成员')}</ArkmeReadReceiptStatus>}
    </ArkmeReadReceiptPanel>}
    {deleting && <ArkmeConfirmDialog titleId="team-message-delete-title" title={tr('删除快记')}
      description={tr('删除的内容将在数据管理中保留30天，所有引用它的位置都会同步更新。')}
      confirmLabel={tr('确认删除')} busyLabel={tr('正在保存…')} confirmTone="danger" busy={busy} {...(error ? {error} : {})}
      onConfirm={() => { void mutateMessage() }} onClose={() => { setDeleting(undefined) }} />}


    <div className="arkme-conversation-composer" data-arkme-width-composer onClick={event => { focusArkmeComposerFromClick(editor.current, event) }} style={{...composerLayout.composer, flexDirection: 'column'}} data-team-composer={editing ? 'reedit' : 'message'}>
      {editing && <ArkmeComposerTargetPreview mode="reedit" label={tr('重新编辑:')} text={editing.latestText ?? editing.message.content?.text_content ?? ''} closeLabel={tr('关闭重新编辑')} disabled={busy} onClose={() => {setEditing(undefined);setError('')}} />}
      <div ref={composer} className="arkme-conversation-composer-inner" data-arkme-primary-composer="true" data-arkme-composer-focused={composerFocused ? 'true' : 'false'}
        style={{ ...composerLayout.composerInner, cursor: 'text', transition: 'background-color 140ms ease, box-shadow 140ms ease', boxShadow: composerFocused ? '0 0 0 1px rgba(0,0,0,0.02)' : 'none', ...arkmeConversationComposerBorder(composerFocused || editing ? arkmeTheme.border : 'transparent', !!editing, resize.highlighted), background: composerFocused ? 'var(--arkme-primary-composer-focused, #ffffff)' : 'var(--arkme-primary-composer-idle, #f6f6f6)' }}>
        {resize.handle}
        {addOpen && <ArkmeActionMenu label={tr('添加内容')} getAnchorRect={() => addTrigger.current?.getBoundingClientRect() ?? null} side="top" onClose={() => setAddOpen(false)} actions={[{id:'file',label:tr('添加附件'),icon:<Paperclip />,onSelect:()=>{setAddOpen(false);fileInput.current?.click()}}]} />}
        {(!current.channel.enabled || current.blocked) && <p>{tr(current.blocked ? '此对话已被屏蔽，双方暂时不能发送或编辑消息' : '团队已暂停接收新消息')}</p>}
        <div className="arkme-conversation-input-card"><ArkmeRichComposerInput ref={editor} className="arkme-conversation-textarea" key={editing ? editing.message.key : 'draft'} ariaLabel={tr(editing ? '修改消息内容' : '团队消息内容')} placeholder={arkmeComposerPlaceholderText({kind:'team_conversation',recipient:current.side === 'team' ? 'person' : 'team',displayName:current.side === 'team' ? current.visitor?.nickname ?? '' : current.channel.name})} value={richDraft.text} mentions={richDraft.mentions} emojis={richDraft.emojis} maxLength={20_000 - ((editing?.text ?? draft.text).length - richDraft.text.length)}
          disabled={editing ? busy : uploading}
          style={{ ...composerLayout.textarea, ...resize.editorStyle, background: 'transparent', color: arkmeTheme.text }}
          selectionRequest={selectionRequest} onSelectionChange={(_text,start,end) => { editorSelection.current = {start,end} }}
          onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)}
          onTextChange={text => updateText(serializeArkmeComposerDraft({...richDraft,text,emojis:reconcileArkmeComposerEmojis(richDraft.text,text,richDraft.emojis)}).text)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (editing) void mutateMessage(); else void send() } }}
          onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void upload(event.clipboardData.files) } }} /></div>
        {!editing && !draft.attempt && draft.assets.length > 0 && <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>{draft.assets.map((asset, index) => <ArkmeAttachmentDraftTile key={`${asset.fileAssetUid}:${index}`} asset={asset} {...(localMedia.current.has(asset.fileAssetUid) ? {previewUrl: localMedia.current.get(asset.fileAssetUid)!} : {})} disabled={!!draft.attempt || busy} onRemove={() => setDraft(value => ({ ...value, assets: value.assets.filter((_, i) => i !== index) }))} />)}</div>}
        {!editing && !draft.attempt && (draft.localFiles?.length ?? 0) > 0 && <div style={{display:'flex',gap:8,overflowX:'auto'}}>{draft.localFiles!.map(file => <ArkmeAttachmentDraftTile key={file.fileRef} asset={file} previewUrl={createArkmeSdk().localFileUrl(file.fileRef)} disabled={busy || uploading} onRemove={() => setDraft(value => ({...value,localFiles:value.localFiles?.filter(item=>item.fileRef!==file.fileRef) ?? []}))} />)}</div>}
        <div data-arkme-composer-footer="tools" style={composerLayout.tools}>
          <div style={{display:'flex',alignItems:'center',gap:2}}>
          {!editing && <><ArkmeComposerToolButton ref={addTrigger} title={tr('添加内容')} aria-label={tr('添加内容')} aria-haspopup="menu" aria-expanded={addOpen} disabled={!!draft.attempt || uploading || busy || !current.channel.enabled || current.blocked} onClick={() => setAddOpen(value => !value)}><ArkmeComposerPlusIcon /></ArkmeComposerToolButton>
          <input ref={fileInput} aria-label={tr('选择附件')} hidden type="file" multiple disabled={!!draft.attempt || uploading || busy || !current.channel.enabled || current.blocked} onChange={e => { void upload(e.target.files); e.target.value = '' }} /></>}
          <ArkmeEmojiPicker mode="text" accountKey={accountKey} scopeKey={storageKey} disabled={busy || uploading || !!editing || !current.channel.enabled || current.blocked}
            getCaretGeometry={() => editor.current?.getCaretGeometry()} getEditorGeometry={() => editor.current?.getEditorGeometry()} onBeforeToggle={captureSelection}
            onSelect={emoji => {
              const {start,end} = editorSelection.current
              const inserted = insertArkmeComposerEmoji(richDraft,emoji,start,end)
              if (!inserted) return false
              updateText(serializeArkmeComposerDraft(inserted.snapshot).text)
              const capturedScope = composerScope
              setSelectionRequest({text:inserted.snapshot.text,start:inserted.caretIndex,end:inserted.caretIndex,canApply:()=>currentScope.current === capturedScope})
              return true
            }} onError={setError} />
          {!editing && Number(accountKey.split(':').at(-1)) > 0 && <ArkmeComposerScreenshotButton userId={Number(accountKey.split(':').at(-1))} scope={composerScope}
            disabled={!!draft.attempt || uploading || busy || !current.channel.enabled || current.blocked}
            isCurrent={() => !ctrl.current.signal.aborted && currentScope.current === composerScope}
            onBegin={options => { editor.current?.focus({preventScroll:true}); return beginPasteFocus({nativeDialog:true,...options}) }}
            onFile={file => upload([file])} onError={setError} />}
          </div>
          {uploading && <span role="status">{tr('正在准备附件…')}</span>}
          {editing && !editing.needsReload && <span />}
          {editing?.needsReload && <ArkmeComposerToolButton disabled={busy} onClick={() => { void reloadEdit() }}>{tr('读取最新版本')}</ArkmeComposerToolButton>}
          {editing ? <ArkmeComposerSendButton ariaLabel={tr(editing.latestText !== undefined ? '确认覆盖最新版本' : '保存修改')} disabled={busy || !!editing.needsReload || !current.channel.enabled || current.blocked || (!editing.text.trim() && !editing.message.media.length)} onClick={() => { void mutateMessage() }} /> : <ArkmeComposerSendButton shortcutHint={tr('Enter发送 / Shift+Enter换行')} ariaLabel={draft.attempt ? tr('重试') : tr('发送')} disabled={busy || uploading || !timeline || (!draft.attempt && !draft.text.trim() && !draft.assets.length && !draft.localFiles?.length) || (!draft.attempt && (!current.channel.enabled || current.blocked))} onClick={() => { void send() }} />}

        </div>
      </div>
    </div>
  </section>
}

export function TeamChannelSettings({ teamRef, accountKey, onChanged }: { teamRef: string; accountKey: string; onChanged(): void }) {
  useArkmeLocale()
  const [channel, setChannel] = useState<TeamChannel>(), [applications, setApplications] = useState<TeamPage<TeamApplication>>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; failed: boolean; sequence: number }>()
  const settingsRef = useRef<HTMLElement>(null), noticeSequence = useRef(0)
  const dismissNotice = useCallback(() => setNotice(undefined), [])
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
  const copyLink = async () => {
    if (!channel?.link) return
    try { await navigator.clipboard.writeText(channel.link); if (!ctrl.current.signal.aborted) setNotice({text: tr('链接已复制'), failed: false, sequence: ++noticeSequence.current}) }
    catch { if (!ctrl.current.signal.aborted) setNotice({text: tr('复制失败，请手动复制链接'), failed: true, sequence: ++noticeSequence.current}) }
  }
  const pendingCount = applications?.items.filter(a => a.state === 'pending').length ?? 0
  return <section ref={settingsRef} className="team-settings" aria-label={tr('接收外部消息')}>
    {error && <div role="alert" className="team-error">{error}<button type="button" disabled={busy} onClick={() => { void refresh() }}>{tr('重试')}</button></div>}
    {!channel && !error && <p role="status">{tr('正在加载…')}</p>}
    {channel && <div className="team-channel-card">
      <div className="team-channel-state">
        <span className="team-channel-icon" aria-hidden><LinkSimple size={22} /></span>
        <div><h2>{tr('接收外部消息')}</h2></div>
        {channel.canManage && <button type="button" role="switch" className="team-channel-switch" aria-checked={channel.enabled}
          aria-label={tr('接收外部消息')} disabled={busy}
          onClick={() => {
            if (!channel.publicRef) setConfirm({ label: tr('建立通道后，现有成员均可查看全部团队对话。请核对团队成员名单；此后新成员须经所有者审批。确认建立？'), run: () => configure(true) })
            else void mutate(() => configure(!channel.enabled))
          }}><span /></button>}
      </div>
      {channel.publicRef && <div className="team-channel-sharing">
        <div className="team-channel-link-row">
          <input aria-label={tr('团队消息分享链接')} readOnly value={channel.link} onFocus={e => e.currentTarget.select()} />
          <button type="button" className="arkme-team-action" onClick={() => { void copyLink() }}><Copy size={16} />{tr('复制链接')}</button>
          {channel.canManage && <ArkmeComposerToolButton className="team-link-reset" aria-label={tr('重置链接')} title={tr('重置链接')} disabled={busy}
            onClick={() => { setConfirm({ label: tr('重置后旧链接失效，已存在的会话继续保留。确认重置？'), run: () => configure(channel.enabled, true) }) }}><ArrowClockwise size={18} aria-hidden /></ArkmeComposerToolButton>}
        </div>
        <p className="team-channel-link-help">{tr('外部用户可通过链接发消息')}</p>
      </div>}

    </div>}
    {channel?.canManage && pendingCount > 0 &&
      <details className="team-setting-disclosure" open={pendingCount > 0}>
        <summary><span>{tr('加入申请')}</span><small>{pendingCount > 0 ? tr('{v0} 条待处理', { v0: pendingCount }) : tr('没有待处理申请')}</small></summary>
        <div className="team-setting-disclosure-body">
          {applications?.items.map(a => <div className="team-member-row" key={a.ref}>
            <span><strong>{a.name}</strong><small>{new Date(a.requestedAt).toLocaleString()}</small></span>
            {a.state === 'pending' && <div className="team-application-actions"><button disabled={busy} onClick={() => { void mutate(() => callArkme('team.app.application.decide', { applicationRef: a.ref, approve: false }, ctrl.current.signal)) }}>{tr('拒绝')}</button>
              <button className="arkme-team-action" disabled={busy} onClick={() => { setConfirm({ label: tr('同意 {name} 加入后，对方可查看全部团队对话历史并代表团队回复。确认同意？', { name: a.name }), run: () => callArkme('team.app.application.decide', { applicationRef: a.ref, approve: true }, ctrl.current.signal) }) }}>{tr('同意')}</button></div>}
          </div>)}
          {applications?.hasMore && <button disabled={busy} onClick={() => { void loadApplications(applications.nextCursor, ++generation.current).catch(e => { setError(errorText(e)) }) }}>{tr('更多申请')}</button>}
        </div>
      </details>}
    {notice && <Toast key={notice.sequence} text={notice.text} anchor={settingsRef.current} icon={notice.failed ? <IconWarningOutline16 /> : <IconCheckOutline16 />} onDone={dismissNotice} />}
    {confirm && <div className="team-confirm" role="alert"><p>{confirm.label}</p><button disabled={busy} onClick={() => { setConfirm(undefined) }}>{tr('取消')}</button><button className="arkme-team-action" disabled={busy} onClick={() => { void mutate(confirm.run) }}>{tr('确认')}</button></div>}
  </section>
}
