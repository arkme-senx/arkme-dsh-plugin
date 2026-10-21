import { teamMessageActionUnavailable } from './team-message-action-availability.js'
import { useAskDsh } from './use-ask-dsh.js'
import { canAskDshTeamMessage, prepareTeamAskDsh } from './team-ask-dsh.js'
import { ArkmeComposerInfoRow } from './ArkmeComposerInfoRow.js'
import { ArkmeComposerInputStats, useArkmeComposerInputTimePreference } from './ArkmeComposerInputStats.js'
import { ArkmeMessageSnapshotDialog } from './ArkmeMessageSnapshotDialog.js'
import { useTeamMessageSelection } from './use-team-message-selection.js'
import { ArkmeMessageSelectionBar } from './ArkmeMessageSelectionBar.js'
import { ArkmeSelectActionIcon } from './message-selection-presentation.js'
import { RegionMarquee } from './selection/RegionMarquee.js'
import { TeamMessageDetail } from './TeamMessageDetail.js'
import { useTeamPersonNames } from './use-team-person-names.js'
import { TeamMessageContent, teamMessagePresentation } from './TeamMessageContent.js'
import { arkmeMessageCopyText } from './message-copy-text.js'
import { copyText } from './clipboard-text.js'
import { AskDshIcon } from './AskDshIcon.js'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { TeamReceiptDetails } from './TeamReadReceipts.js'
import { TeamReceiptStore, emptyTeamReceipt } from './team-read-receipts.js'
import { ArkmeConversationDate } from './ArkmeConversationDate.js'
import { requirePhoneForSocialAction, isSocialBindingRequired } from './social-action-guard.js'
import { arkmeClipboardFiles } from './clipboard-files.js'
import { teamTaskShowsInlineStatus, useTeamSendTasks } from './team-send-tasks.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ArkmeSendTaskStatus } from './ArkmeSendTaskStatus.js'
import { createPortal } from 'react-dom'
import { attachmentPreviewBridge } from './attachment-preview-window.js'
import { localFileBlock } from './file-send-tasks.js'
import type { TeamSendTask } from '../team-send-contract.js'
import { ConfirmedSendRetentionOwner } from './confirmed-send-retention.js'
import { ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS } from './conversation-memory-cache.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeTopicTagBadge } from './ArkmeTopicTagBadge.js'
import { TeamVisitorMembership } from './TeamVisitorMembership.js'
import { useTeamVisitorActions } from './TeamVisitorActions.js'
import { TeamVisitorRecords } from './TeamVisitorRecords.js'
import { ArkmePinnedCorner } from './ArkmePinnedCorner.js'
import { useTeamConversationEntryActions } from './TeamConversationEntryActions.js'
import { teamDirectoryPreferences, teamConversationEntryKey, teamFolderEntryKey, teamEntryHidden, teamEntryPinned, useTeamDirectoryPreferences } from './team-directory-preferences.js'
import { arkmeVisibleReadIntentAllowed, subscribeArkmeReadIntentAvailability } from './read-intent-visibility.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { ArkmeTeamChannelAvatar } from './ArkmeTeamAvatar.js'
import { arkmeConversationAnchorOffset, arkmeConversationViewport } from './conversation-viewport.js'
import { arkmeConversationRestoredScrollTop, type ArkmeConversationViewportSnapshot } from './conversation-memory-cache.js'
import { ArkmeComposerTargetPreview } from './ArkmeComposerTargetPreview.js'
import { Toast, IconCheckOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { arkmeUi } from './ui-controller.js'
import { conversationDirectoryStyles as directoryStyles, conversationTimeLabel } from './conversation-directory-presentation.js'
import { LinkSimple } from '@phosphor-icons/react/dist/icons/LinkSimple'
import { Paperclip } from '@phosphor-icons/react/dist/icons/Paperclip'
import { startTeamDirectory, subscribeTeamDirectory, readTeamDirectory, refreshTeamDirectory, discardTeamDirectory } from './team-conversation-directory.js'
import { startOfficialTeamMembership } from './official-team-membership.js'
import { startTeamAttention } from './team-attention-store.js'
import { showBrowserNotification } from './browser-notification.js'
import { teamText as tr } from './team-messaging-i18n.js'
import { useArkmeLocale } from './locale.js'
import { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { callArkme } from './api.js'
import { createArkmeSdk } from '../sdk/index.js'
import type { ArkmeContentBlock, ArkmeUploadedAsset } from '../types.js'
import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import type { TeamApplication, TeamChannel, TeamContent, TeamConversation, TeamIdentity, TeamMessage, TeamOpen, TeamPage, TeamTimeline } from '../team-app-contract.js'
import { openTeamMessages, subscribeTeamMessageChanges, type TeamMessageIntent } from './team-messaging-events.js'
import { loadTeamDraft, persistTeamDraft, updateTeamDraftText, validTeamDraftStart, type TeamDraft as Draft } from './team-message-draft.js'
import { TeamConversationMessage } from './TeamConversationMessage.js'
import { ArkmeMessageTextSelectionToolbar } from './ArkmeMessageTextSelection.js'
import { TeamConversationTools } from './TeamConversationTools.js'
import { teamHistoryDate } from './team-history-browser.js'
import { applyMessageTextReplacement, resolveMessageTextReplacement } from './message-text-replacement.js'
import { useMessageUnderlines } from './ArkmeMessageUnderlines.js'
import { teamMessageMarkTransport } from './team-message-marks.js'
import { arkmeConversationMessageLayout as messageLayout, dayKey } from './conversation-message-presentation.js'
import { arkmeConversationComposerLayout as composerLayout, arkmeConversationComposerBorder } from './conversation-composer-presentation.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from './ArkmeRichComposerInput.js'
import { ArkmeComposerSendButton } from './ArkmeComposerSendButton.js'
import { ArkmeComposerToolButton } from './ArkmeComposerToolButton.js'
import { ArkmeAttachmentDraftTile, ArkmeMediaPreview, openSessionAttachmentPreview } from './ArkmeRichContent.js'
import { ArkmeAttachmentStrip, ArkmeFilePreparingIndicator } from './ArkmeAttachmentStrip.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { Fragment } from 'react'
import { ArkmeReadReceiptPanel } from './ArkmeReadReceiptPanel.js'

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
    ...(attempt.replyTarget ? {replyToKey:attempt.replyTarget.key} : {}),
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

export function TeamConversationRow({ conversation: c, accountKey, selected = false, showTeamName = true, role, onClick }: {
  conversation: TeamConversation; accountKey?: string; selected?: boolean; showTeamName?: boolean; role?: 'treeitem'; onClick(): void
}) {
  const actions = useTeamConversationEntryActions(accountKey, { kind: 'conversation', conversation: c })
  const preview = c.preview?.status === 'available'
    ? c.preview.text || (c.preview.templateKind === 3 ? tr('[语音]') : c.preview.hasMedia ? tr('[附件]') : '')
    : c.preview ? tr('内容暂不可用') : ''
  return <><button className="team-conversation-row" data-team-side={c.side} type="button" role={role}
    {...(role === 'treeitem' ? { 'aria-selected': selected } : {})} data-arkme-feedback="neutral"
    style={{ ...directoryStyles.chatRow, ...(selected ? { background: arkmeTheme.active } : {}) }} onContextMenu={actions.onContextMenu} onClick={() => actions.open(onClick)}>
    {actions.pinned && <ArkmePinnedCorner />}
    <span style={directoryStyles.sourceAvatarWrap}>
      {c.side === 'team'
        ? <TeamAvatar size={directoryStyles.sourceAvatarWrap.width} identity={c.visitor ?? { nickname: tr('用户') }} />
        : <ArkmeTeamChannelAvatar size={directoryStyles.sourceAvatarWrap.width} channel={c.channel}/>}
      {c.unread > 0 && <span style={directoryStyles.mentionUnread}>{c.unread > 99 ? '99+' : c.unread}</span>}
    </span>
    <span data-arkme-conversation-content style={directoryStyles.chatContent}>
      <span style={directoryStyles.chatTop}>
        <span style={directoryStyles.entryName}>{c.side === 'team' ? c.visitor?.nickname ?? tr('用户') : c.channel.name}</span>
        <TeamVisitorMembership conversation={c} />
        <ArkmeTopicTagBadge label={c.side === 'team' ? `${showTeamName ? `${c.channel.name} · ` : ''}${tr('外部用户')}` : c.channel.name} selected={selected} truncate />
        <span style={{ ...directoryStyles.chatTime, marginLeft: 'auto' }}>{conversationTimeLabel(c.updatedAt)}</span>
      </span>
      <span style={directoryStyles.chatBottom}><span style={directoryStyles.preview}><ArkmeRichText text={preview} presentation="preview" emojiSize={20} /></span></span>
    </span>
  </button>{actions.overlays}</>
}

export function TeamMessagingMount({ accountKey, active }: { accountKey: string; active: boolean }) {
  useArkmeLocale()
  useEffect(() => {
    if (!active) return
    let live = true
    const notices = new Set<() => void>()
    const stopDirectory = startTeamDirectory(accountKey)
    const stopMembership = startOfficialTeamMembership(accountKey)
    const stop = startTeamAttention(accountKey, value => {
      if (document.visibilityState === 'visible' && document.hasFocus()) return
      const close = showBrowserNotification(tr('团队消息'), value.external || value.team ? tr('你有新的团队消息，点击查看') : tr('有待处理的团队加入申请'), `arkme-team-${accountKey}`, () => {
        if (live) openTeamMessages({ kind: 'inbox', side: value.external ? 'external' : 'team' })
      })
      if (close) { for (const previous of notices) previous(); notices.clear(); notices.add(close) }
    })
    return () => { live = false; stop(); stopDirectory(); stopMembership(); for (const close of notices) close() }
  }, [accountKey, active])
  return null
}

/** The existing workspace owns navigation. Team owns only its conversation content. */
export function TeamMessagingPanel({ accountKey, intent }: { accountKey: string; intent: TeamMessageIntent }) {
  useArkmeLocale()
  const preferences = useTeamDirectoryPreferences(accountKey)
  const directory = useSyncExternalStore(subscribeTeamDirectory, () => readTeamDirectory(accountKey), () => readTeamDirectory(accountKey))
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot)
  const [selected, setSelected] = useState<TeamConversation>()
  const [channel, setChannel] = useState<TeamChannel>()
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setSelected(undefined); setChannel(undefined); setError(''); setLoading(true)
    const run = async () => {
      if (intent.kind === 'conversation') {
        await teamDirectoryPreferences.restore(accountKey, teamConversationEntryKey(intent.conversation))
        controller.signal.throwIfAborted()
        if (intent.conversation.side === 'team') await teamDirectoryPreferences.restore(accountKey, teamFolderEntryKey(intent.conversation.channel.jotmoId))
        controller.signal.throwIfAborted()
        setSelected(intent.conversation); return
      }
      if (intent.kind === 'inbox') { void refreshTeamDirectory(accountKey); return }
      if (intent.kind === 'team') { if (intent.channel) await teamDirectoryPreferences.restore(accountKey, teamFolderEntryKey(intent.channel.jotmoId)); return }
      const publicRef = intent.kind === 'official'
        ? (await callArkme<TeamChannel>('team.app.official', { expectedAccountKey: accountKey }, controller.signal)).publicRef : intent.publicRef
      const value = await callArkme<TeamOpen>('team.app.open', { publicRef, expectedAccountKey: accountKey }, controller.signal)
      if (controller.signal.aborted) return
      setChannel(value.channel)
      if (value.conversation) {
        await teamDirectoryPreferences.restore(accountKey, teamConversationEntryKey(value.conversation))
        controller.signal.throwIfAborted()
        setSelected(value.conversation)
      }
      else if (value.openInbox === true) openTeamMessages({kind:'team',teamRef:value.channel.teamRef,channel:value.channel})
      else throw new Error(tr('暂时无法打开对话，请重试'))
      void refreshTeamDirectory(accountKey)
    }
    void run().catch(e => { if (!controller.signal.aborted) setError(errorText(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [accountKey, intent, attempt])
  if (selected) return <div className="team-message-panel">
    <TeamConversationPane key={`${accountKey}:${selected.side}:${selected.key}`} accountKey={accountKey} conversation={selected}
      onChanged={() => { void refreshTeamDirectory(accountKey) }}
      onAccessLost={() => { discardTeamDirectory(accountKey, selected); arkmeUi.forgetTeamConversation(selected.channel) }} />
  </div>
  if (intent.kind === 'team' || intent.kind === 'inbox' && intent.side === 'team') return <section className="team-message-panel" aria-label={tr('团队对话')}>
    <header style={messageLayout.header}><strong style={messageLayout.title}>{ui.teamDirectory?.channel?.name ?? tr('团队对话')}</strong></header>
    <div className="team-empty">{tr('选择一个对话，查看消息')}</div>
  </section>
  const directoryAllowed = intent.kind === 'inbox'
  const initialDirectoryLoad = directory.loading && !directory.hasLoaded
  const items = (directoryAllowed ? directory.items : [])
    .filter(c => !teamEntryHidden(preferences, { kind: 'conversation', conversation: c }) && (channel ? c.side === 'team' && c.channel.jotmoId === channel.jotmoId : intent.kind !== 'inbox' || !intent.side || c.side === intent.side))
    .sort((a, b) => Number(teamEntryPinned(preferences, { kind: 'conversation', conversation: b })) - Number(teamEntryPinned(preferences, { kind: 'conversation', conversation: a })))
  return <section className="team-message-panel" aria-label={tr('团队对话')}>
    <header style={messageLayout.header}><div style={messageLayout.titleBlock}><strong style={messageLayout.title}>{channel?.name ?? tr(intent.kind === 'official' ? '联系作者' : '团队对话')}</strong>{channel && <small style={messageLayout.headerSubtitle}>{tr('团队对话')}</small>}</div></header>
    {loading ? <div className="team-empty" role="status">{tr('正在打开对话…')}</div>
      : error ? <div className="team-opening-error" role="alert"><p>{error}</p><button onClick={() => { setAttempt(v => v + 1) }}>{tr('重试')}</button></div>
      : <div className="team-conversation-directory">
        {directory.error && <div className="team-opening-error" role="alert"><p>{tr(directory.error)}</p><button disabled={directory.loading} onClick={() => { void refreshTeamDirectory(accountKey) }}>{tr('重试')}</button></div>}
        <div role="list" aria-label={tr('团队对话')}>{items.map(c => <div role="listitem" key={`${c.side}:${c.key}`}><TeamConversationRow accountKey={accountKey} conversation={c} showTeamName={!channel}
          onClick={() => { openTeamMessages({ kind: 'conversation', conversation: c }) }} /></div>)}</div>
        {items.length === 0 && !directory.error && <p className="team-empty" role={initialDirectoryLoad ? 'status' : undefined}>{tr(initialDirectoryLoad ? '正在加载团队对话…' : '还没有团队对话')}</p>}
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
  const messageMarks = useMessageUnderlines(`${accountKey}:team:${conversation.key}`, conversation.ref, Number(accountKey.split(':').at(-1)), teamMessageMarkTransport)
  const [composerFocused, setComposerFocused] = useState(false)
  const [detailKey, setDetailKey] = useState<string>()
  const [snapshotKey, setSnapshotKey] = useState<string>()
  const closeSnapshot = useCallback(() => setSnapshotKey(undefined), [])
  const [showsInputTime, setShowsInputTime] = useArkmeComposerInputTimePreference()
  const [visitorRecords, setVisitorRecords] = useState(false), [recordPerson, setRecordPerson] = useState<TeamIdentity>(), [locatedKey, setLocatedKey] = useState<string>()
  const paneHost = useRef<HTMLElement>(null)
  const historyWindow = useRef(0)
  const [historyWindowOpen, setHistoryWindowOpen] = useState(false)
  const delivery = useTeamSendTasks(conversation.ref, accountKey)
  const storageKey = `arkme.team.draft:${accountKey}:${conversation.key}`
  const [draft, setDraft] = useState<Draft>(() => loadTeamDraft(localStorage, storageKey)), [timeline, setTimeline] = useState<TeamTimeline>()
  const [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false)
  const [draftPreview, setDraftPreview] = useState<ArkmeContentBlock>()
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
  const receiptStore = useMemo(() => new TeamReceiptStore(accountKey), [accountKey, conversation.key])
  const [receiptMessage, setReceiptMessage] = useState<TeamMessage>()
  const receiptState = useSyncExternalStore(receiptStore.subscribe, () => receiptMessage ? receiptStore.get(receiptMessage.key) : emptyTeamReceipt, () => emptyTeamReceipt)
  useEffect(() => receiptStore.retain(), [receiptStore])
  useEffect(() => receiptMessage ? receiptStore.watch(receiptMessage) : undefined, [receiptStore, receiptMessage])
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible' && document.hasFocus()) receiptStore.refreshVisible() }
    const timer = window.setInterval(update, 15_000)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [receiptStore])
  const [editing, setEditing] = useState<{ message: TeamMessage; text: string; startedAtMillis?: number; needsReload?: boolean; latestText?: string }>()
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
    if (editing) setEditing({ ...editing, text, startedAtMillis: editing.startedAtMillis ?? Date.now() })
    else { const next = updateTeamDraftText(draftRef.current, text); draftRef.current = next; setDraft(next) }
  }
  const editorSelection = useRef({start:0,end:0})
  const captureSelection = () => { if (editor.current) editorSelection.current = {start:editor.current.selectionStart,end:editor.current.selectionEnd} }
  useEffect(() => { setAddOpen(false); setSelectionRequest(undefined); setDraftPreview(undefined) }, [composerScope])
  useEffect(() => {
    if (draftPreview && !draft.localFiles?.some(file => file.fileRef === draftPreview.localFileRef)) setDraftPreview(undefined)
  }, [draft.localFiles, draftPreview])
  const viewport = useRef<ArkmeConversationViewportSnapshot>()
  const uploadBusy = useRef(false)
  const sendBusy = useRef(false)
  const latest = useRef(timeline); latest.current = timeline
  const draftRef = useRef(draft); draftRef.current = draft
  const resumeSend = useRef<() => Promise<void>>(async () => {})
  const recovering = useRef(false), recoverAgain = useRef(false)
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost
  useEffect(() => { try { persistTeamDraft(localStorage, storageKey, draft) } catch { setError(tr("草稿未能保存到本机，请勿关闭窗口")) } }, [storageKey, draft])
  useEffect(() => () => { ctrl.current.abort() }, [])
  const receiptRef = useRef(receiptMessage); receiptRef.current = receiptMessage
  const receiptAnchor = useRef<HTMLElement | null>(null)
  const readReceipts = useCallback((message: TeamMessage, more = false) => {
    receiptRef.current = message; setReceiptMessage(message)
    return receiptStore.load(message, more, true)
  }, [receiptStore])
  const refresh = useCallback(async (beforeSeq = 0, replace = false) => {
    const token = ++generation.current
    const windowBefore = historyWindow.current
    try {
      let data = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, expectedAccountKey: accountKey, beforeSeq: beforeSeq || windowBefore }, ctrl.current.signal)
      const head = data.conversation, old = replace ? undefined : latest.current, oldest = old?.messages[0]?.seq ?? 0
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
      const openedReceipt = receiptRef.current && data.messages.find(m => m.key === receiptRef.current?.key)
      if (openedReceipt && (openedReceipt.state !== 'published' || openedReceipt.contentStatus !== 'available')) {
        receiptRef.current = undefined; setReceiptMessage(undefined)
      }
      receiptStore.refreshVisible(true)
      if (!windowBefore && beforeSeq && head.lastSeq > (data.messages.at(-1)?.seq ?? 0)) void refresh()
      return data
    } catch (e) { if (!ctrl.current.signal.aborted && token === generation.current) { setLoadError(errorText(e)); if (inaccessible(e)) { accessLost.current?.(); confirmed.current.clear(); setOutgoing(undefined); setTimeline(undefined); receiptStore.dispose(); receiptRef.current = undefined; setReceiptMessage(undefined); setEditing(undefined) } } }
  }, [conversation.ref, receiptStore])
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
    if (!current || !visible.current || !arkmeVisibleReadIntentAllowed()) return
    const sequence = Math.max(0, ...current.messages.map(m => m.seq))
    if (!sequence || sequence <= read.current) return
    const previous = read.current; read.current = sequence
    void callArkme('team.app.read', { conversationRef: conversation.ref, readSeq: sequence }, ctrl.current.signal).then(onChanged).catch(() => { read.current = previous })
  }, [conversation.ref, onChanged])
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { visible.current = entries.some(v => v.isIntersecting); advance() }, { root: scroller.current, threshold: 1 })
    if (bottom.current) observer.observe(bottom.current)
    window.addEventListener('focus', advance); document.addEventListener('visibilitychange', advance); advance()
    const stopReadAvailability = subscribeArkmeReadIntentAvailability(advance)
    return () => { stopReadAvailability(); observer.disconnect(); window.removeEventListener('focus', advance); document.removeEventListener('visibilitychange', advance) }
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
    sendBusy.current = true
    try { await requirePhoneForSocialAction('发送消息', ctrl.current.signal) }
    catch (e) { if (!ctrl.current.signal.aborted && !isSocialBindingRequired(e)) setError(errorText(e)); return }
    finally { sendBusy.current = false }
    if (ctrl.current.signal.aborted || latest.current?.conversation.ref !== timeline.conversation.ref || draftRef.current !== draft) return
    const attempt = draft.attempt ?? { uid: crypto.randomUUID(), createdAt: Date.now(), startedAtMillis: draft.startedAtMillis, content: teamDraftContent(draft), expectedReplySeq: timeline.conversation.latestTeamReplySeq, fileRefs: (draft.localFiles ?? []).map(file => file.fileRef), replyTarget: draft.replyTarget }
    const acceptedDraft = { ...draft, replyTarget: draft.attempt ? draft.replyTarget : undefined, text: draft.attempt ? draft.text : '', startedAtMillis: draft.attempt ? draft.startedAtMillis : undefined, attempt }
    try { persistTeamDraft(localStorage, storageKey, acceptedDraft) } catch { setError(tr('无法保存发送请求，请释放本机存储后再发送')); return }
    sendBusy.current = true; draftRef.current = acceptedDraft; setDraft(acceptedDraft); setBusy(true); setError('')
    setOutgoing(outgoing ?? pendingTeamMessage(acceptedDraft, conversation, localMedia.current, timeline.messages.findLast(m => m.own)?.sender))
    try {
      const task = await callArkme<TeamSendTask>('team.app.send.enqueue', { conversationRef: conversation.ref, clientUid: attempt.uid, content: attempt.content, expectedReplySeq: attempt.expectedReplySeq, fileRefs: attempt.fileRefs ?? [], ...(attempt.replyTarget ? {replyToRef:attempt.replyTarget.ref} : {}) }, ctrl.current.signal)
      if (ctrl.current.signal.aborted) return
      if (task?.clientUid !== attempt.uid || !task.taskRef || !Array.isArray(task.files)) throw new Error(tr('发送状态暂时无法确认，请重试'))
      delivery.accept(task)
      const next = { text: draftRef.current.text, replyTarget: draftRef.current.replyTarget, startedAtMillis: draftRef.current.startedAtMillis, assets: [] }
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
        if (['social-phone-binding-required', 'team-invalid_request', 'team-queue-full', 'file-local-missing', 'team-channel_paused', 'team-conversation_blocked'].includes(code ?? '')) {
          const kept = { replyTarget: draftRef.current.replyTarget ?? attempt.replyTarget, text: restoreTeamDraftText(attempt.content.text_content, draftRef.current.text), startedAtMillis: attempt.startedAtMillis ?? draftRef.current.startedAtMillis, assets: draft.assets, ...(draft.localFiles ? {localFiles:draft.localFiles} : {}) }
          try { persistTeamDraft(localStorage, storageKey, kept); draftRef.current = kept; setDraft(kept); setOutgoing(undefined) }
          catch { setError(tr('草稿未能保存到本机，请勿关闭窗口')) }
        }
      }
    } finally { sendBusy.current = false; if (!ctrl.current.signal.aborted) setBusy(false) }
  }
  resumeSend.current = send
  const upload = async (files: FileList | readonly File[] | null) => {
    if (!files?.length || editing || busy || uploadBusy.current || draft.attempt || !latest.current?.conversation.channel.enabled || latest.current.conversation.blocked) return
    // The file picker is reset synchronously after onChange; retain its selection
    // before awaiting capabilities, just as the ordinary Chat composer does.
    const picked = Array.from(files)
    uploadBusy.current = true; setUploading(true); setError('')
    try {
      const sdk = createArkmeSdk(), policy = await sdk.fileCapabilities()
      const userId = Number(accountKey.split(':').at(-1))
      const errors: string[] = []
      for (const file of picked) {
        if (ctrl.current.signal.aborted) return
        if (draftRef.current.assets.length + (draftRef.current.localFiles?.length ?? 0) >= policy.maxAttachments) {
          errors.push(tr('最多添加 {v0} 个附件：{v1}', {v0:policy.maxAttachments,v1:file.name})); continue
        }
        const limit = file.type.startsWith('image/') ? policy.maxImageBytes : policy.maxFileBytes
        if (file.size === 0 || file.size > limit) {
          errors.push(tr('{v0} 为空或超过 {v1} MiB', {v0:file.name,v1:Math.floor(limit / 1024 / 1024)})); continue
        }
        let local
        try { local = await sdk.stageFile(file, { signal: ctrl.current.signal, ...(userId > 0 ? {expectedUserId:userId} : {}) }) }
        catch (e) { if (ctrl.current.signal.aborted) return; errors.push(`${file.name}：${errorText(e)}`); continue }
        if (ctrl.current.signal.aborted) return
        // Persist before exposing a staged file. A storage failure stops the batch;
        // an individual invalid file does not discard the remaining selections.
        const next = { ...draftRef.current, startedAtMillis: draftRef.current.startedAtMillis ?? Date.now(), localFiles: [...(draftRef.current.localFiles ?? []), local] }
        persistTeamDraft(localStorage, storageKey, next); draftRef.current = next; setDraft(next)
      }
      if (errors.length) setError(errors.join('；'))
    } catch (e) { if (!ctrl.current.signal.aborted) setError(errorText(e)) }
    finally { uploadBusy.current = false; if (!ctrl.current.signal.aborted) setUploading(false) }
  }
  const selectFiles = (files: FileList | readonly File[] | null, pasted = false) => {
    if (!files?.length || editing || busy || uploadBusy.current || draft.attempt || !latest.current?.conversation.channel.enabled || latest.current.conversation.blocked) return
    if (!pasted) editor.current?.focus({ preventScroll: true })
    const restoreFocus = beginPasteFocus()
    setSelectionRequest(undefined)
    void upload(files).finally(restoreFocus)
  }
  const updateLocalFiles = (update: (files: ArkmeLocalFile[]) => ArkmeLocalFile[]) => {
    if (busy || uploadBusy.current || draftRef.current.attempt) return
    const next = updateTeamDraftText({...draftRef.current, localFiles: update([...(draftRef.current.localFiles ?? [])])}, draftRef.current.text)
    try { persistTeamDraft(localStorage, storageKey, next); draftRef.current = next; setDraft(next) }
    catch (e) { setError(errorText(e)) }
  }
  const previewLocalFile = (file: ArkmeLocalFile) => {
    const block = localFileBlock(file)
    if (attachmentPreviewBridge()?.version === 1) {
      try { openSessionAttachmentPreview((draftRef.current.localFiles ?? []).map(localFileBlock), block, 'composer') }
      catch { setError(tr('无法创建预览窗口，请再次点击附件重试')) }
    } else setDraftPreview(block)
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
      if (editing?.message.content) await callArkme('team.app.edit', { messageRef: editing.message.ref, version: editing.message.version, content: { ...editing.message.content, text_content: editing.text } }, ctrl.current.signal)
      setEditing(undefined); await refresh(); onChanged()
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
  const taskRows = delivery.tasks.filter(task => !['sent', 'cancelled'].includes(task.state))
  const visibleMessages = [...(timeline?.messages ?? [])]
  for (const task of taskRows) {
    if (visibleMessages.some(message => message.key === task.message?.key)) continue
    visibleMessages.push({
      key: task.message?.key ?? task.clientUid, ref: task.message?.ref ?? '', seq: 0, revision: 0,
      side: conversation.side, sender: timeline?.messages.findLast(message => message.own)?.sender ?? {nickname:''},
      own: true, state: 'sending', ...(task.replyToKey ? {replyToKey:task.replyToKey} : {}), createdAt: task.createdAtMillis, canEdit:false, canDelete:false, version:0,
      contentStatus:'available', content:task.sendContent ?? task.content,
      media: task.files.map(file => ({ref:file.fileRef,key:file.fileRef,url:createArkmeSdk().localFileUrl(file.fileRef),name:file.fileName,mimeType:file.mimeType,size:file.size,kind:file.fileKind})),
    })
  }
  if (outgoing && !taskRows.some(task => task.clientUid === outgoing.key)) visibleMessages.push(outgoing)
  const rawCurrent = timeline?.conversation ?? conversation
  const rawVisitor = rawCurrent.visitor
  const visitorIdentity = visibleMessages.find(m => m.side === 'external' && m.sender.personKey)?.sender
  const withVisitorIdentity = rawVisitor && visitorIdentity && !rawVisitor.personKey ? { ...visitorIdentity, ...rawVisitor } : rawVisitor
  const personName = useTeamPersonNames(rawCurrent, accountKey, [...visibleMessages.map(m => m.sender), ...(receiptState.value?.members ?? []), ...(withVisitorIdentity ? [withVisitorIdentity] : [])])
  const current = withVisitorIdentity ? { ...rawCurrent, visitor: personName(withVisitorIdentity) } : rawCurrent
  const visitorActions = useTeamVisitorActions({ conversation: current, accountKey,
    onOpen: () => { setVisitorRecords(false); receiptRef.current = undefined; setReceiptMessage(undefined) },
    resolveIdentity: personName,
    onRecords: person => { setDetailKey(undefined); setRecordPerson(person); setVisitorRecords(true) },
  })
  const locateVisitorRecord = async (message: TeamMessage, signal: AbortSignal) => {
    let page = latest.current
    for (let pass = 0; !page?.messages.some(m => m.key === message.key) && pass < 100; pass++) {
      signal.throwIfAborted()
      if (page && (!page.hasMore || page.beforeSeq <= message.seq)) break
      const previous = page?.beforeSeq
      page = await refresh(previous ?? 0)
      if (ctrl.current.signal.aborted) return
      if (!page || previous && page.hasMore && page.beforeSeq >= previous) throw new Error(tr('原消息暂时无法定位，请重试'))
    }
    signal.throwIfAborted()
    const found = page?.messages.find(m => m.key === message.key)
    if (!found || found.state !== 'published' || found.contentStatus !== 'available') throw new Error(tr('原消息已删除或暂时无法访问'))
    setLocatedKey(message.key)
  }
  useLayoutEffect(() => {
    if (!locatedKey) return
    const row = Array.from(scroller.current?.querySelectorAll<HTMLElement>('[data-team-message-key]') ?? []).find(node => node.dataset.teamMessageKey === locatedKey)
    row?.scrollIntoView({ block: 'center' })
    if (scroller.current) viewport.current = arkmeConversationViewport(scroller.current)
  }, [locatedKey])
  useEffect(() => {
    if (!locatedKey) return
    const timer = setTimeout(() => setLocatedKey(undefined), 2400)
    return () => clearTimeout(timer)
  }, [locatedKey])
  const selection = useTeamMessageSelection({ accountKey, messages: timeline?.messages ?? [], viewport: scroller, signal: ctrl.current.signal, refresh, onChanged })
  const displayedMessages = visibleMessages.filter(selection.keeps).map(m => { const sender = personName(m.sender); return sender === m.sender ? m : { ...m, sender } })
  const snapshot = displayedMessages.find(message => message.key === snapshotKey && message.own && message.state === 'published' && message.contentStatus === 'available')
  useEffect(() => { if (snapshotKey && !snapshot) setSnapshotKey(undefined) }, [snapshotKey, !!snapshot])
  const detail = displayedMessages.find(message => message.key === detailKey && message.state === 'published' && message.contentStatus === 'available')
  useEffect(() => { if (detailKey && !detail) setDetailKey(undefined) }, [detailKey, !!detail])
  const copySelected = async () => {
    if (selection.selected.length !== 1 || selection.busy) return
    try { await copyText(arkmeMessageCopyText(teamMessagePresentation(selection.selected[0]!))) }
    catch { if (!ctrl.current.signal.aborted) setError(tr('复制失败，请重试')) }
  }
  const askDsh = useAskDsh(JSON.stringify([accountKey, conversation.key, [...selection.ids ?? []].sort()]), () => {
    selection.exit(); setDetailKey(undefined); arkmeUi.showHarness()
  })
  const askMessages = (messages: readonly TeamMessage[]) => {
    if (selection.busy || askDsh.busy) return
    const selected = messages.map(message => ({ ...message, sender: personName(message.sender) }))
    void askDsh.runPrepared(JSON.stringify(selected.map(message => [message.key, message.version])),
      (signal, progress) => prepareTeamAskDsh(current, selected, accountKey, signal, progress))
  }
  const extendMessage = (message: TeamMessage) => {
    if (busy || editing || draftRef.current.attempt || !current.channel.enabled || current.blocked) { setError(tr('请先完成当前编辑或发送')); return }
    if (message.state !== 'published' || message.contentStatus !== 'available') return
    const next: Draft = { ...draftRef.current, replyTarget: { ref: message.ref, key: message.key, seq: message.seq,
      senderName: message.sender.nickname, text: arkmeMessageCopyText(teamMessagePresentation(message)) || tr('[附件]') } }
    try { persistTeamDraft(localStorage, storageKey, next); draftRef.current = next; setDraft(next); setDetailKey(undefined); setError(''); requestAnimationFrame(() => editor.current?.focus()) }
    catch { setError(tr('草稿未能保存到本机，请重试')) }
  }
  const [locatingReply, setLocatingReply] = useState<string>()
  const locateReplyBusy = useRef(false)
  const locateReply = async (key: string) => {
    if (locateReplyBusy.current) return
    locateReplyBusy.current = true; setLocatingReply(key); setError('')
    try {
      let page = latest.current
      for (let pass = 0; !page?.messages.some(message => message.key === key) && pass < 100; pass++) {
        ctrl.current.signal.throwIfAborted()
        if (page && !page.hasMore) break
        const before = page?.beforeSeq
        page = await refresh(before ?? 0)
        if (!page || before && page.hasMore && page.beforeSeq >= before) throw new Error(tr('原消息暂时无法定位，请重试'))
      }
      ctrl.current.signal.throwIfAborted()
      const found = page?.messages.find(message => message.key === key)
      if (!found || found.state !== 'published' || found.contentStatus !== 'available') throw new Error(tr('原消息未找到或暂时不可访问'))
      setDetailKey(undefined); setLocatedKey(key)
    } catch (error) { if (!ctrl.current.signal.aborted) setError(errorText(error)) }
    finally { locateReplyBusy.current = false; if (!ctrl.current.signal.aborted) setLocatingReply(undefined) }
  }
  return <section ref={paneHost} className="team-conversation-pane" style={{ position: 'relative', minHeight: 0 }}>
    {messageMarks.layer}
    {!selection.ids && <ArkmeMessageTextSelectionToolbar key={`${accountKey}:${conversation.key}`} replySourceRef={conversation.ref}
      markStorage="local" onUnderline={messageMarks.mark} getMarks={messageMarks.getMarks} onRemoveMark={messageMarks.remove}
      canReplace={target => !!latest.current?.messages.find(message => message.key === target.item.itemUid)?.canEdit && current.channel.enabled && !current.blocked}
      prepareReplace={async (target, quote, signal) => {
        const old = latest.current?.messages.find(message => message.key === target.item.itemUid)
        if (!old || editing || busy || !old.canEdit || !current.channel.enabled || current.blocked) throw new Error('请先完成当前编辑，并确认此消息仍可编辑')
        const range = resolveMessageTextReplacement(target.item, quote)
        const page = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: conversation.ref, expectedAccountKey: accountKey, beforeSeq: old.seq + 1 }, signal)
        const message = page.messages.find(value => value.key === old.key)
        if (!message?.canEdit || message.state !== 'published' || message.contentStatus !== 'available' || !message.content
          || message.version !== old.version || message.content.text_content !== target.item.textContent) throw new Error('消息已变化或不可编辑，请重新选择')
        const content = message.content
        return { save: async value => {
          signal.throwIfAborted()
          const next = applyMessageTextReplacement(content.text_content, range, value)
          if (!next.text.trim() && !message.media.length) throw new Error('消息内容不能为空')
          if (next.text.length > 20_000) throw new Error('消息最多 20000 个字符')
          if (next.text === content.text_content) return
          await callArkme('team.app.edit', { messageRef: message.ref, expectedAccountKey: accountKey, version: message.version, content: { ...content, text_content: next.text } }, signal)
          if (signal.aborted) return
          await refresh(); onChanged()
        } }
      }} />}
    <header style={messageLayout.header}>
      <div style={messageLayout.titleGroup}><div style={messageLayout.titleBlock}>
        <div style={messageLayout.titleLine}><strong style={messageLayout.title}>{current.side === 'team' ? current.visitor?.nickname : current.channel.name}</strong><TeamVisitorMembership conversation={current} /></div>
        <small style={messageLayout.headerSubtitle}>{current.side === 'team' ? `${current.channel.name} · ${tr('外部用户')}` : tr('团队对话')}</small>
      </div></div>
      <TeamConversationTools key={`${accountKey}:${conversation.key}`} conversation={current} accountKey={accountKey} host={paneHost}
        overlayOpen={!!(detailKey || snapshotKey || visitorRecords || receiptMessage)} resolveIdentity={personName} onOpenPanel={() => { setDetailKey(undefined); setSnapshotKey(undefined); setVisitorRecords(false); receiptRef.current = undefined; setReceiptMessage(undefined) }}
        getReadingDate={() => {
          const node = scroller.current
          if (!node) return undefined
          const top = node.getBoundingClientRect().top
          const row = [...node.querySelectorAll<HTMLElement>('[data-team-message-key]')].find(el => el.getBoundingClientRect().bottom > top)
          const message = latest.current?.messages.find(m => m.key === row?.dataset.teamMessageKey)
          return message ? teamHistoryDate(message.createdAt) : undefined
        }}
        onLocate={async (message, signal) => {
          signal.throwIfAborted()
          let page = latest.current
          if (!page?.messages.some(m => m.key === message.key)) {
            historyWindow.current = message.seq + 26
            setHistoryWindowOpen(true)
            page = await refresh(0, true)
          }
          signal.throwIfAborted()
          const found = page?.messages.find(m => m.key === message.key)
          if (!found || found.state !== 'published' || found.contentStatus !== 'available') throw new Error(tr('原消息已删除或暂时无法访问'))
          setDetailKey(undefined); setLocatedKey(undefined)
          requestAnimationFrame(() => { if (!signal.aborted) setLocatedKey(message.key) })
        }}/>
    </header>
    {historyWindowOpen && <div style={{ textAlign: 'center', padding: 6 }}><button type="button" onClick={() => {
      historyWindow.current = 0; setHistoryWindowOpen(false); latest.current = undefined; viewport.current = undefined
      void refresh(0, true)
    }}>{tr('回到最新消息')}</button></div>}
    {loadError && <div role="alert" className="team-error">{loadError} <button type="button" onClick={() => { void recover() }}>{tr('重试')}</button></div>}
    {error && <div role="alert" className="team-error">{error}</div>}
    {askDsh.status && <div role="status" aria-live="polite" style={{ padding: '8px 16px', color: arkmeTheme.secondary, fontSize: 12 }}>{askDsh.status}</div>}
    {(selection.status || selection.error) && <div role={selection.error ? 'alert' : 'status'} style={{ padding: '8px 16px', color: selection.error ? arkmeTheme.danger : arkmeTheme.secondary, fontSize: 12 }}>
      {selection.status} {selection.error}
      {selection.error && <button type="button" disabled={selection.busy} onClick={() => { void recover() }}>{tr('刷新核对')}</button>}
      {!selection.busy && <button type="button" aria-label={tr('关闭操作提示')} onClick={selection.clearStatus}>×</button>}
    </div>}
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    <div ref={scroller} className="team-message-list" data-arkme-message-selection-scope onScroll={() => { if (scroller.current) viewport.current = arkmeConversationViewport(scroller.current) }} aria-label={tr("团队消息记录")}>
      {timeline?.hasMore && <button onClick={() => { void refresh(timeline.beforeSeq) }}>{tr("加载更早消息")}</button>}
      {displayedMessages.map((m, index) => <Fragment key={delivery.tasks.find(task => task.message?.key === m.key)?.clientUid ?? m.key}>
        {(index === 0 || dayKey(m.createdAt) !== dayKey(displayedMessages[index - 1]!.createdAt)) && <div style={{ ...messageLayout.date, textAlign: 'center' }}><ArkmeConversationDate at={m.createdAt} /></div>}
        <TeamConversationMessage message={m} conversationRef={conversation.ref} located={locatedKey === m.key}
          avatar={current.side === 'team' && !selection.ids
            ? visitorActions.avatar(<TeamAvatar identity={m.sender} size={messageLayout.messageAvatar.width as number} />, m.side === 'external' ? undefined : m.sender)
            : <TeamAvatar identity={m.sender} size={messageLayout.messageAvatar.width as number} />} writable={current.channel.enabled && !current.blocked}
          showReceipts={current.side === 'team'} receiptStore={receiptStore} busy={busy || selection.busy || askDsh.busy}
          onAskDsh={canAskDshTeamMessage(m) ? () => askMessages([m]) : undefined}
          onExtend={() => extendMessage(m)} replyParent={displayedMessages.find(parent => parent.key === m.replyToKey)}
          locatingReply={!!m.replyToKey && locatingReply === m.replyToKey} onLocateReply={() => { if (m.replyToKey) void locateReply(m.replyToKey) }}
          selecting={selection.ids !== undefined} selected={selection.ids?.has(m.key) ?? false}
          onSelect={() => { setDetailKey(undefined); selection.enter(new Set([m.key])) }} onToggle={() => selection.toggle(m.key)} onDetail={() => setDetailKey(m.key)} onSnapshot={() => { setDetailKey(undefined); setSnapshotKey(m.key) }}
          onEdit={() => { setError(''); setEditing({ message: m, text: m.content?.text_content ?? '' }) }}
          onReceipts={anchor => { if (receiptRef.current?.key === m.key) { receiptRef.current = undefined; setReceiptMessage(undefined) } else { receiptAnchor.current = anchor; void readReceipts(m) } }} onError={setError} />
        {taskRows.filter(task => (task.message?.key ?? task.clientUid) === m.key && teamTaskShowsInlineStatus(task)).map(task => <ArkmeSendTaskStatus label={tr('发送状态')} key={task.taskRef} own state={task.state}>
          {tr(task.cancelRequested ? '正在取消…' : task.state === 'failed' ? task.error ?? '发送失败' : task.state === 'retrying' || task.state === 'queued' ? '等待发送' : task.state === 'uploading' ? '正在上传…' : '正在发送…')}
          {(task.state === 'failed' && task.cancelRequested) && <button type="button" data-arkme-feedback="neutral" onClick={() => {void actOnTask(task,'retry')}}>{tr('重试')}</button>}
          {!task.cancelRequested && task.state === 'failed' && <button type="button" data-arkme-feedback="neutral" onClick={() => {void actOnTask(task,'cancel')}}>{tr('取消发送')}</button>}
        </ArkmeSendTaskStatus>)}
      </Fragment>)}
      <div ref={bottom} className="team-read-sentinel" />
    </div>
    <RegionMarquee viewportRef={scroller} scopeKey={`${accountKey}:${conversation.key}`} enabled={!busy && !selection.busy && !editing && !selection.confirm && !detail}
      getItems={() => [...scroller.current?.querySelectorAll<HTMLElement>('[data-team-selectable]') ?? []].map(element => ({ key: element.dataset.teamSelectable!, element }))}
      onCommit={selection.enter} style={{ border: `1px solid ${arkmeTheme.accent}`, background: arkmeTheme.active }} />
    </div>
    {selection.ids && <ArkmeMessageSelectionBar count={selection.selected.length} actions={[
      { id: 'copy', label: tr('复制文本'), icon: <ArkmeSelectActionIcon kind="copy" />, disabled: selection.selected.length !== 1 || selection.busy, reason: selection.selected.length !== 1 ? tr('请选择一条消息复制文本') : undefined, onSelect: () => { void copySelected() } },
      { id: 'link', label: tr('复制链接'), icon: <ArkmeSelectActionIcon kind="link" />, disabled: true, reason: tr(teamMessageActionUnavailable.link), onSelect() {} },
      { id: 'forward', label: tr('转发'), icon: <ArkmeSelectActionIcon kind="forward" />, disabled: true, reason: tr(teamMessageActionUnavailable.forward), onSelect() {} },
      { id: 'ask-dsh', label: askDsh.busy ? tr('准备中') : '问 DSH', icon: <AskDshIcon size={22} />, disabled: selection.busy || askDsh.busy || !selection.selected.length || selection.selected.some(message => !canAskDshTeamMessage(message)), onSelect: () => askMessages(selection.selected) },
      { id: 'delete', label: tr('删除'), icon: <Trash size={22} />, disabled: !selection.canDelete || selection.busy || busy, reason: !selection.canDelete ? tr('请选择 1 至 100 条有权删除的消息') : undefined, danger: true, onSelect: selection.requestDelete },
      { id: 'close', label: tr('退出多选'), icon: <ArkmeSelectActionIcon kind="close" size={18} />, disabled: selection.busy, onSelect: selection.exit },
    ]} />}
    {selection.confirm && <ArkmeConfirmDialog titleId="team-selected-delete-title" title={tr('删除快记')}
      description={`确认删除所选 ${selection.confirm.length} 条快记？删除的内容将在数据管理中保留30天，所有引用它的位置都会同步更新。`}
      confirmLabel={tr('确认删除')} busyLabel={tr('正在保存…')} confirmTone="danger" busy={selection.busy}
      onConfirm={() => { void selection.remove() }} onClose={selection.closeConfirm} />}
    {snapshot && <ArkmeMessageSnapshotDialog item={teamMessagePresentation(snapshot)}
      metadataUnavailable={tr('团队消息的发送位置、设备和输入时长暂未接通。')} createdAtMillis={snapshot.createdAt}
      backgroundSoundSupported={false} onClose={closeSnapshot} />}
    {detail && <TeamMessageDetail message={detail} conversation={current}
      onExtend={current.channel.enabled && !current.blocked && !busy && !editing ? () => extendMessage(detail) : undefined}
      replyParent={displayedMessages.find(parent => parent.key === detail.replyToKey)}
      locatingReply={!!detail.replyToKey && locatingReply === detail.replyToKey} onLocateReply={() => { if (detail.replyToKey) void locateReply(detail.replyToKey) }}
      avatar={visitorActions.avatar(<TeamAvatar identity={detail.sender} size={40} />, detail.side === 'external' ? undefined : detail.sender)}
      onClose={() => setDetailKey(undefined)} onLocate={() => { setDetailKey(undefined); setLocatedKey(detail.key) }} />}

    {receiptMessage && <ArkmeReadReceiptPanel anchor={receiptAnchor.current} label={tr('查看阅读状态')}
      onClose={() => { receiptRef.current = undefined; setReceiptMessage(undefined) }}>
      <TeamReceiptDetails key={receiptMessage.key} message={receiptMessage} state={{ ...receiptState, ...(receiptState.value ? { value: { ...receiptState.value, members: receiptState.value.members.map(personName) } } : {}) }} visitor={current.visitor}
        onRetry={() => { void readReceipts(receiptMessage) }} onMore={() => { void readReceipts(receiptMessage, true) }}
        renderAvatar={identity => visitorActions.avatar(<TeamAvatar identity={identity} size={20} />, identity)}
        renderVisitorAvatar={identity => visitorActions.avatar(<TeamAvatar identity={identity} size={20} />)} />
    </ArkmeReadReceiptPanel>}
    {visitorActions.layer}
    {visitorRecords && current.side === 'team' && <TeamVisitorRecords key={`${accountKey}:${conversation.key}:${recordPerson?.personKey ?? "external"}`} person={recordPerson ? personName(recordPerson) : undefined} conversation={current}
      accountKey={accountKey} onClose={() => setVisitorRecords(false)} onLocate={locateVisitorRecord} />}



    <div className="arkme-conversation-composer" data-arkme-width-composer onClick={event => { focusArkmeComposerFromClick(editor.current, event) }} onDragOver={event => { if (!editing && !busy && !uploading && !draft.attempt && current.channel.enabled && !current.blocked && event.dataTransfer.types.includes('Files')) event.preventDefault() }}
      onDrop={event => { if (event.dataTransfer.files.length && !editing && !busy && !uploading && !draft.attempt && current.channel.enabled && !current.blocked) { event.preventDefault(); selectFiles(event.dataTransfer.files) } }}
      style={{...composerLayout.composer, flexDirection: 'column', ...(selection.ids ? { display: 'none' } : {})}} data-team-composer={editing ? 'reedit' : 'message'}>
      <ArkmeComposerInfoRow destination={current.side === 'team' ? `${current.visitor?.nickname ?? tr('用户')}（${current.channel.name}）` : current.channel.name} focused={composerFocused && !editing}>
        <ArkmeComposerInputStats active visible={composerFocused || !!richDraft.text || !!draft.localFiles?.length || !!draft.assets.length}
          textLength={Array.from(richDraft.text).length} startedAtMillis={validTeamDraftStart(editing ? editing.startedAtMillis : draft.startedAtMillis)}
          showsInputTime={showsInputTime} onToggle={() => setShowsInputTime(!showsInputTime)} />
      </ArkmeComposerInfoRow>
      {!editing && (draft.replyTarget ?? draft.attempt?.replyTarget) && <ArkmeComposerTargetPreview mode="extension"
        label={`${tr('延展')} · ${(draft.replyTarget ?? draft.attempt?.replyTarget)!.senderName}`}
        text={(draft.replyTarget ?? draft.attempt?.replyTarget)!.text} closeLabel={tr('取消延展')} disabled={busy || !!draft.attempt}
        onClose={() => { const next = {...draftRef.current, replyTarget:undefined}; try { persistTeamDraft(localStorage, storageKey, next); draftRef.current = next; setDraft(next) } catch { setError(tr('草稿未能保存到本机，请重试')) } }} />}
      {editing && <ArkmeComposerTargetPreview mode="reedit" label={tr('重新编辑:')} text={editing.latestText ?? editing.message.content?.text_content ?? ''} closeLabel={tr('关闭重新编辑')} disabled={busy} onClose={() => {setEditing(undefined);setError('')}} />}
      <div ref={composer} className="arkme-conversation-composer-inner" data-arkme-primary-composer="true" data-arkme-composer-focused={composerFocused ? 'true' : 'false'}
        style={{ ...composerLayout.composerInner, cursor: 'text', transition: 'background-color 140ms ease, box-shadow 140ms ease', boxShadow: composerFocused ? '0 0 0 1px rgba(0,0,0,0.02)' : 'none', ...arkmeConversationComposerBorder(composerFocused || editing ? arkmeTheme.border : 'transparent', !!editing, resize.highlighted), background: composerFocused ? 'var(--arkme-primary-composer-focused, #ffffff)' : 'var(--arkme-primary-composer-idle, #f6f6f6)' }}>
        {resize.handle}
        {addOpen && <ArkmeActionMenu label={tr('添加内容')} getAnchorRect={() => addTrigger.current?.getBoundingClientRect() ?? null} side="top" onClose={() => setAddOpen(false)} actions={[{id:'file',label:tr('添加附件'),icon:<Paperclip />,onSelect:()=>{setAddOpen(false);fileInput.current?.click()}}]} />}
        {(!current.channel.enabled || current.blocked) && <p>{tr(current.blocked ? '此对话已被屏蔽，双方暂时不能发送或编辑消息' : '团队已暂停接收新消息')}</p>}
        <div className="arkme-conversation-input-card"><ArkmeRichComposerInput ref={editor} className="arkme-conversation-textarea" key={editing ? editing.message.key : 'draft'} ariaLabel={tr(editing ? '修改消息内容' : '团队消息内容')} placeholder={arkmeComposerPlaceholderText({kind:'team_conversation',recipient:current.side === 'team' ? 'person' : 'team',displayName:current.side === 'team' ? current.visitor?.nickname ?? '' : current.channel.name})} value={richDraft.text} mentions={richDraft.mentions} emojis={richDraft.emojis} maxLength={20_000 - ((editing?.text ?? draft.text).length - richDraft.text.length)}
          disabled={editing ? busy : uploading}
          style={{ ...composerLayout.textarea, ...resize.editorStyle, background: 'transparent', color: arkmeTheme.text }}
          selectionRequest={uploading ? undefined : selectionRequest} onSelectionChange={(_text,start,end) => { editorSelection.current = {start,end} }}
          onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)}
          onTextChange={(text, emojis) => updateText(serializeArkmeComposerDraft({...richDraft,text,emojis:emojis ?? reconcileArkmeComposerEmojis(richDraft.text,text,richDraft.emojis)}).text)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (editing) void mutateMessage(); else void send() } }}
          onPaste={event => {
            if (editing || busy || uploading || draft.attempt || !current.channel.enabled || current.blocked) return
            const files = arkmeClipboardFiles(event.clipboardData)
            if (files.length) { event.preventDefault(); selectFiles(files, true) }
          }} /></div>
        {!editing && !draft.attempt && draft.assets.length > 0 && <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>{draft.assets.map((asset, index) => <ArkmeAttachmentDraftTile key={`${asset.fileAssetUid}:${index}`} asset={asset} {...(localMedia.current.has(asset.fileAssetUid) ? {previewUrl: localMedia.current.get(asset.fileAssetUid)!} : {})} disabled={!!draft.attempt || busy} onRemove={() => setDraft(value => ({ ...value, assets: value.assets.filter((_, i) => i !== index) }))} />)}</div>}
        {!editing && !draft.attempt && (draft.localFiles?.length ?? 0) > 0 && <ArkmeAttachmentStrip
          attachments={draft.localFiles!.map(localFile => ({localFile}))} disabled={busy || uploading}
          onPreview={attachment => { if (attachment.localFile) previewLocalFile(attachment.localFile) }}
          onRemove={attachment => updateLocalFiles(files => files.filter(file => file.fileRef !== attachment.localFile?.fileRef))}
          onMove={(from,to) => updateLocalFiles(files => {
            const file = files[from]
            if (!file || to < 0 || to >= files.length) return files
            files.splice(from,1); files.splice(to,0,file); return files
          })} />}
        <div data-arkme-composer-footer="tools" style={composerLayout.tools}>
          <div style={{display:'flex',alignItems:'center',gap:2}}>
          {!editing && <><ArkmeComposerToolButton ref={addTrigger} title={tr('添加内容')} aria-label={tr('添加内容')} aria-haspopup="menu" aria-expanded={addOpen} disabled={!!draft.attempt || uploading || busy || !current.channel.enabled || current.blocked} onClick={() => setAddOpen(value => !value)}>{uploading ? <ArkmeFilePreparingIndicator /> : <ArkmeComposerPlusIcon />}</ArkmeComposerToolButton>
          <input ref={fileInput} aria-label={tr('选择附件')} hidden type="file" multiple disabled={!!draft.attempt || uploading || busy || !current.channel.enabled || current.blocked} onChange={e => { selectFiles(e.target.files); e.target.value = '' }} /></>}
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
          {editing && !editing.needsReload && <span />}
          {editing?.needsReload && <ArkmeComposerToolButton disabled={busy} onClick={() => { void reloadEdit() }}>{tr('读取最新版本')}</ArkmeComposerToolButton>}
          {editing ? <ArkmeComposerSendButton ariaLabel={tr(editing.latestText !== undefined ? '确认覆盖最新版本' : '保存修改')} disabled={busy || !!editing.needsReload || !current.channel.enabled || current.blocked || (!editing.text.trim() && !editing.message.media.length)} onClick={() => { void mutateMessage() }} /> : <ArkmeComposerSendButton shortcutHint={tr('Enter发送 / Shift+Enter换行')} ariaLabel={draft.attempt ? tr('重试') : tr('发送')} disabled={busy || uploading || !timeline || (!draft.attempt && !draft.text.trim() && !draft.assets.length && !draft.localFiles?.length) || (!draft.attempt && (!current.channel.enabled || current.blocked))} onClick={() => { void send() }} />}

        </div>
      </div>
    </div>
    {draftPreview && !editing && typeof document !== 'undefined' && createPortal(<ArkmeMediaPreview
      selected={draftPreview} blocks={(draft.localFiles ?? []).map(localFileBlock)} onSelect={setDraftPreview}
      onClose={() => setDraftPreview(undefined)} openLocalFile={false} />, document.body)}
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
        {(channel.canPause ?? channel.canManage) && <button type="button" role="switch" className="team-channel-switch" aria-checked={channel.enabled}
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
