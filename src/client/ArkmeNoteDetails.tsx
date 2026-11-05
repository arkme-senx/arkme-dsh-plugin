import { WorldPublicationBadge, WorldPublicationActions } from './WorldPublicationControls.js'
import { arkoInteractionJump } from './arko-interaction-jump.js'
import { recordOwnerId } from '../record-owner-id.js'
import { NoteWorldReactionArchive } from './NoteWorldReactionArchive.js'
import { detailExtensionSends, useDetailExtensionSends, DetailExtensionSendStatus, type DetailExtensionSend } from './detail-extension-send.js'
import { readDetailExtensionPages } from './detail-extension-pages.js'
import {TeamRepresentationBadge, TeamRepresentationAvatar} from './TeamRepresentationBadge.js'
import { arkmeExtensionDetailListStyles } from './extension-detail-list-styles.js'
import { ArkmeQuotePreview } from './ArkmeQuotePreview.js'
import { useMessageQuoteThreads } from './MessageQuoteThreads.js'
import { quoteThreadKey } from './message-quote-threads.js'
import { subscribeMessageQuoteInvalidations } from './message-quote-invalidations.js'
import { loadRelatedQuickNotes } from './related-quick-notes-query.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { ArkmeRecordEditHistory } from './ArkmeRecordEditHistory.js'
import { RecordThoughtContent, useRecordThoughtReplySummary } from './RecordThoughts.js'
import { useThoughtContinuations } from './thought-continuations.js'
import type { ArkmeRecordThought } from '../record-thought-contract.js'
import { ArkmeComposerTargetPreview } from './ArkmeComposerTargetPreview.js'
import { activateDetailReplyKey, detailReplyClickAllowed } from './detail-reply-interaction.js'
import { ArkmeBotSenderName } from './ArkmeBotIdentity.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeMessageDetailAuthor } from './ArkmeMessageDetailAuthor.js'
import { arkmeDetailExtensionComposerStyles } from './detail-extension-composer-style.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from './ArkmeRichComposerInput.js'
import type { ArkmeMarkdownDraft } from './markdown-editor.js'
import type { ArkmeProviderCapabilities } from '../types.js'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { observeDetailScrollAnchor } from './detail-scroll-anchor.js'
import { isArkmeTransientReadFailure } from './read-retry.js'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { FileTextIcon } from '@phosphor-icons/react/dist/csr/FileText'
import type {
  ArkmeBotMentionInput,
  ArkmeConversationMemberItem,
  ArkmeForwardRecordPreviewItem,
  ArkmeHumanMentionInput,
  ArkmeMessageCopyLinkExtensionItem,
  ArkmeOpenPrivateChatResult,
  ArkmeSourceItem,
  ArkmeRelatedQuickNoteDetail as ArkmeRelatedQuickNoteDetailDto,
  ArkmeRelatedQuickNoteItem,
  ArkmeRelatedQuickNoteList,
  ArkmeSourceMessageExtendResult,
  ArkmeSourceMessageExtensionContext,
  ArkmeSourceKind,
  ArkmeSelfRole,
  ArkmeSelfRoleSnapshot,
  ArkmeTimelineItem,
  ArkmeTimelineMentionTarget,
  ArkmeUserProfile,
} from '../types.js'
import { DeepSeekLogoMark } from './ArkmeDshAgentInputMarker.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeSelfRolePicker } from './ArkmeSelfRolePicker.js'
import { arkmePersonalAvatarRef, arkmeSelfRoleAvatarFallback, arkmeSelfRoleForPresentation } from './self-role-presentation.js'
import { ArkmeTopicSourceIcon, arkmeDetailSourceBadgeStyle } from './ArkmeDetailSourceBadgeVisuals.js'
import { ArkmeForwardArticleContent, ArkmeMediaPreview, ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import {
  ArkmeRelatedQuickNoteDetail,
  ArkmeRelatedQuickNotesCard,
  ArkmeRelatedQuickNotesList,
  relatedDrawerBackTarget,
  type ArkmeRelatedDrawerView,
  type ArkmeRelatedQuickNoteDetailState,
  type ArkmeRelatedQuickNotesLoadState,
} from './ArkmeRelatedQuickNotes.js'
import { ArkmeClientError, callArkme } from './api.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { arkmeTheme } from './arkme-theme.js'
import { createArkmeSdk } from '../sdk/index.js'
import { attachmentPreparationHint, AttachmentPreparationQueue } from './attachment-preparation.js'
import { ArkmeAttachmentStrip } from './ArkmeAttachmentStrip.js'
import {
  arkmeComposerAtomicDeletion,
  insertArkmeComposerMentionToken,
  reconcileArkmeComposerEmojis,
  reconcileArkmeComposerMentions,
  releaseArkmeComposerAttachment, arkmeAttachmentsPending,
  serializeArkmeComposerDraft,
  type ArkmeComposerAttachment,
  type ArkmeComposerEmoji,
  type ArkmeComposerMention,
} from './composer-draft-store.js'
import { localFileBlock } from './file-send-tasks.js'
import { recordingSpeakerColor } from './recordings/recording-speaker-presentation.js'
import {
  arkmeComposerMentionTrigger,
  arkmeGroupMentionCandidates,
  arkmeMemberForMention,
  arkmePrivateMentionCandidates,
  type ArkmeMentionCandidate,
} from './mention-candidates.js'
import { ArkmeComposerSendButton } from './ArkmeComposerSendButton.js'
import { ArkmeMentionSuggestions } from './ArkmeMentionSuggestions.js'
import { useMentionSuggestions } from './use-mention-suggestions.js'
import { useMentionBots } from './use-mention-bots.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'

const styles: Record<string, CSSProperties> = {
  rows: { display: 'flex', flexDirection: 'column', gap: 23 },
  row: { display: 'flex', gap: 9, alignItems: 'flex-start' },
  content: { flex: 1, minWidth: 0 },
  meta: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 },
  name: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: arkmeTheme.secondary, fontSize: 12, fontWeight: 600 },
  time: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  extensionComposer: { display: 'flex', flexDirection: 'column' },
  extensionAttachmentPreview: { padding: '8px 16px' },
  extensionInputBar: arkmeDetailExtensionComposerStyles.bar,
  extensionInputWrap: arkmeDetailExtensionComposerStyles.shell,
  extensionInput: arkmeDetailExtensionComposerStyles.input,
  extensionTool: { width: 18, height: 28, flex: 'none', alignSelf: 'flex-start', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer' },
  mentionSuggestions: {
    position: 'absolute', left: 16, right: 16, bottom: 'calc(100% + 8px)', zIndex: 23,
    maxHeight: 252, overflowY: 'auto', padding: 6, boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.menu,
    boxShadow: arkmeTheme.shadow,
  },
  mentionSuggestionRow: {
    width: '100%', minWidth: 0, height: 40, padding: '6px 8px', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 8,
    background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', textAlign: 'left',
  },
  mentionSuggestionRowActive: { background: arkmeTheme.hover },
  mentionSuggestionAvatar: { width: 28, height: 28, flex: 'none', overflow: 'hidden', borderRadius: 999, display: 'grid', placeItems: 'center' },
  mentionSuggestionBotAvatar: {
    width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 999,
    background: arkmeTheme.subtle, color: arkmeTheme.text,
    border: `1px solid ${arkmeTheme.border}`, boxSizing: 'border-box',
  },
  mentionSuggestionText: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  mentionSuggestionName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '17px', fontWeight: 500 },
  mentionSuggestionSecondary: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.secondary, fontSize: 11, lineHeight: '15px' },
  mentionSuggestionsEmpty: { padding: '8px 10px', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  extensionParent: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', margin: '0 0 16px', padding: '4px 0 4px 10px',
    boxSizing: 'border-box', border: 0, borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: arkmeTheme.border,
    background: 'transparent', textAlign: 'left', color: arkmeTheme.tertiary, font: 'inherit', fontSize: 13, lineHeight: '20px', cursor: 'pointer' },
  extensionParentText: { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', overflowWrap: 'anywhere' },
  ...arkmeExtensionDetailListStyles,
  notice: { margin: '12px 0 0', fontSize: 12, color: arkmeTheme.tertiary, lineHeight: '20px' },
  toggle: { margin: '14px 0', border: 0, borderRadius: 8, padding: '6px 9px', background: arkmeTheme.hover, color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 12 },
}

// EditorContent wraps ProseMirror, so the shared Markdown last-child rule cannot reach its final block.
const extensionComposerStyles = `
.arkme-detail-extension-input-shell .ProseMirror > :last-child { margin-bottom:0; }
`

const EMPTY_DETAIL_CONVERSATION_MEMBERS: readonly ArkmeConversationMemberItem[] = Object.freeze([])

function epoch(value: number): number {
  return Number.isFinite(value) && value > 0 && value < 8.64e15 ? value < 1e12 ? value * 1000 : value : 0
}

function dateLabel(value: number): string {
  const time = epoch(value)
  return time === 0 ? '' : new Date(time).toLocaleDateString(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' })
}

function timeLabel(value: number): string {
  const time = epoch(value)
  return time === 0 ? '' : new Date(time).toLocaleTimeString(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
}

function offsetLabel(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}


function clipboardFiles(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const itemFiles = Array.from(data.items).flatMap(item => {
    if (item.kind !== 'file') return []
    const file = item.getAsFile()
    return file === null ? [] : [file]
  })
  return itemFiles.length > 0 ? itemFiles : Array.from(data.files)
}

async function removeDetailExtensionAttachments(attachments: readonly ArkmeComposerAttachment[]): Promise<void> {
  for (const attachment of attachments) releaseArkmeComposerAttachment(attachment)
  const sdk = createArkmeSdk()
  await Promise.allSettled(attachments.flatMap(attachment => attachment.localFile === undefined
    ? [] : [sdk.removeLocalFile(attachment.localFile.fileRef)]))
}

function removeDetailExtensionAttachmentsAfter(
  attachments: readonly ArkmeComposerAttachment[],
  pendingSend?: Promise<unknown>,
): void {
  if (attachments.length === 0) return
  if (pendingSend === undefined) {
    void removeDetailExtensionAttachments(attachments)
    return
  }
  void pendingSend.catch(() => undefined).then(async () => { await removeDetailExtensionAttachments(attachments) })
}

function detailExtensionMentionsEnabled(sourceKind: ArkmeSourceKind | undefined): boolean {
  return sourceKind === 'group_chat' || sourceKind === 'private_chat'
}

function detailHumanMentionInputs(mentions: readonly ArkmeComposerMention[]): ArkmeHumanMentionInput[] {
  return mentions.flatMap<ArkmeHumanMentionInput>(mention => {
    const base = { startIndex: mention.startIndex, length: mention.length }
    if (mention.all === true) return [{ ...base, all: true }]
    return mention.mentionRef === undefined ? [] : [{ ...base, mentionRef: mention.mentionRef }]
  })
}

function detailBotMentionInputs(mentions: readonly ArkmeComposerMention[]): ArkmeBotMentionInput[] {
  return mentions.flatMap<ArkmeBotMentionInput>(mention => {
    if (mention.botRef === undefined) return []
    return [{ botRef: mention.botRef, startIndex: mention.startIndex, length: mention.length }]
  })
}

interface DetailSelfRoleSelection {
  accountKey: string
  userId: number
  selectedRole?: ArkmeSelfRole | undefined
  selfAvatarRef?: string | undefined
  onSelect(role?: ArkmeSelfRole): void
}

type DetailReplyTarget = { kind: 'extension'; item: ArkmeTimelineItem } | { kind: 'thought'; thought: ArkmeRecordThought }

function DetailExtensionComposer({ sourceRef, sourceIdentityKey, sourceKind, conversationMembers, messageActionRef, parentRecordUid, targetKey, selfRoleSelection, parentItem, rootRecordUid, extensionLevel, currentSelfProfile, onError, messageCreationBlocked, messageCreationRestriction, replyTarget, replyFocusRevision, onCancelReply, onQueued }: {
  sourceRef: string
  sourceIdentityKey?: string | undefined
  sourceKind?: ArkmeSourceKind | undefined
  conversationMembers?: readonly ArkmeConversationMemberItem[] | undefined
  messageActionRef: string
  parentRecordUid?: string | undefined
  targetKey: string
  selfRoleSelection?: DetailSelfRoleSelection | undefined
  parentItem: ArkmeTimelineItem
  rootRecordUid: string
  extensionLevel: number
  currentSelfProfile?: ArkmeUserProfile | undefined
  onError: (message: string) => void
  messageCreationBlocked: boolean
  messageCreationRestriction: string
  replyTarget?: DetailReplyTarget | undefined
  replyFocusRevision: number
  onCancelReply(): void
  onQueued(): void
}) {
  useArkmeLocale()
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<ArkmeComposerMention[]>([])
  const [emojis, setEmojis] = useState<ArkmeComposerEmoji[]>([])
  const [markdown, setMarkdown] = useState<ArkmeMarkdownDraft>()
  const markdownRef = useRef(markdown)
  markdownRef.current = markdown
  const [markdownEnabled, setMarkdownEnabled] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeProviderCapabilities>('provider.capabilities', {}, controller.signal).then(value => { if (!controller.signal.aborted) setMarkdownEnabled(value.features.markdownQuickNotes === true) }).catch(() => {})
    return () => controller.abort()
  }, [sourceRef])
  const [attachments, setAttachments] = useState<ArkmeComposerAttachment[]>([])
  const preparing = arkmeAttachmentsPending(attachments)
  const [draftPreview, setDraftPreview] = useState<ArkmeComposerAttachment>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const preparationQueue = useRef<AttachmentPreparationQueue>()
  const generationRef = useRef(0)
  const attachmentsRef = useRef<ArkmeComposerAttachment[]>([])
  const inputRef = useRef<ArkmeRichComposerHandle>(null)
  const textRef = useRef(text)
  const mentionsRef = useRef<readonly ArkmeComposerMention[]>(mentions)
  const emojisRef = useRef<readonly ArkmeComposerEmoji[]>(emojis)
  const [mentionTrigger, setMentionTrigger] = useState<ReturnType<typeof arkmeComposerMentionTrigger>>()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${String(auth.userId)}` : undefined
  const mentionBots = useMentionBots(accountKey, sourceKind, sourceRef, sourceIdentityKey ?? sourceRef, true, mentionTrigger !== undefined)
  const mentionsEnabled = detailExtensionMentionsEnabled(sourceKind)
  const activeConversationMembers = conversationMembers ?? EMPTY_DETAIL_CONVERSATION_MEMBERS
  attachmentsRef.current = attachments
  textRef.current = text
  mentionsRef.current = mentions
  emojisRef.current = emojis
  useEffect(() => {
    generationRef.current += 1
    preparationQueue.current?.dispose(); preparationQueue.current = undefined
    attachmentsRef.current = []
    setText(''); setMentions([]); setEmojis([]); setMarkdown(undefined)
    setMentionTrigger(undefined)
    setAttachments([])
    setDraftPreview(undefined)
    return () => {
      generationRef.current += 1
      preparationQueue.current?.dispose(); preparationQueue.current = undefined
      const pending = attachmentsRef.current
      attachmentsRef.current = []
      removeDetailExtensionAttachmentsAfter(pending)
    }
  }, [targetKey])
  useEffect(() => { setMentionTrigger(undefined) }, [accountKey, sourceKind, sourceRef])
  const mentionCandidates = useMemo((): ArkmeMentionCandidate[] => {
    if (!mentionsEnabled || mentionTrigger === undefined) return []
    if (sourceKind === 'group_chat') {
      return arkmeGroupMentionCandidates(mentionTrigger.query, mentionBots.group, activeConversationMembers)
    }
    if (sourceKind === 'private_chat') {
      return arkmePrivateMentionCandidates(mentionTrigger.query, mentionBots.private)
    }
    return []
  }, [activeConversationMembers, mentionBots.group, mentionTrigger, mentionsEnabled, mentionBots.private, sourceKind])
  const mentionSession = useMentionSuggestions(JSON.stringify([accountKey, sourceIdentityKey ?? sourceRef, targetKey]), mentionTrigger, mentionCandidates, mentionBots.loading || (!mentionBots.ready && !mentionBots.error))
  const focusComposerAt = useCallback((caret: number) => {
    const schedule = typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function'
      ? (callback: FrameRequestCallback) => { callback(0); return 0 }
      : window.requestAnimationFrame.bind(window)
    schedule(() => {
      const editor = inputRef.current
      if (editor === null || editor.disabled) return
      editor.focus()
      editor.setSelectionRange(caret, caret)
    })
  }, [])
  useEffect(() => {
    if (replyFocusRevision > 0) focusComposerAt(textRef.current.length)
  }, [replyFocusRevision, focusComposerAt])
  const updateText = (value: string, nextEmojis?: readonly ArkmeComposerEmoji[]) => {
    if (messageCreationBlocked) return
    const previousText = textRef.current
    setText(value)
    setMentions(reconcileArkmeComposerMentions(previousText, value, mentionsRef.current))
    setEmojis(nextEmojis ? [...nextEmojis] : reconcileArkmeComposerEmojis(previousText, value, emojisRef.current))
  }
  const updateMentionTrigger = useCallback((value: string, selectionStart: number, selectionEnd: number) => {
    if (!mentionsEnabled) {
      setMentionTrigger(undefined)
      return
    }
    setMentionTrigger(arkmeComposerMentionTrigger(value, selectionStart, selectionEnd))
  }, [mentionsEnabled])
  const insertMentionCandidate = useCallback((candidate: ArkmeMentionCandidate) => {
    if (!mentionsEnabled || mentionTrigger === undefined) return
    const mention = candidate.kind === 'all'
      ? { all: true as const }
      : candidate.kind === 'bot'
        ? { botRef: candidate.botRef }
        : { mentionRef: candidate.mentionRef }
    const displayName = candidate.kind === 'member' ? candidate.mentionDisplayName ?? candidate.displayName : candidate.displayName
    const inserted = insertArkmeComposerMentionToken(
      { text: textRef.current, mentions: mentionsRef.current, emojis: emojisRef.current },
      mention,
      displayName,
      mentionTrigger.startIndex,
      mentionTrigger.endIndex,
    )
    if (inserted === undefined) return
    setText(inserted.text)
    setMentions(inserted.mentions)
    setEmojis(inserted.emojis)
    setMarkdown(undefined)
    setMentionTrigger(undefined)
    focusComposerAt(inserted.caretIndex)
  }, [focusComposerAt, mentionTrigger, mentionsEnabled])
  const deleteMentionAtSelection = useCallback((direction: 'backward' | 'forward'): number | undefined => {
    const editor = inputRef.current
    const value = textRef.current
    const deletion = arkmeComposerAtomicDeletion(
      value,
      mentionsRef.current,
      editor?.selectionStart ?? value.length,
      editor?.selectionEnd ?? value.length,
      direction,
    )
    if (deletion === undefined) return undefined
    setText(deletion.text)
    setMentions(reconcileArkmeComposerMentions(value, deletion.text, mentionsRef.current))
    setEmojis(reconcileArkmeComposerEmojis(value, deletion.text, emojisRef.current))
    setMarkdown(undefined)
    setMentionTrigger(undefined)
    return deletion.caretIndex
  }, [])
  const selectFiles = async (files: FileList | readonly File[] | null) => {
    if (messageCreationBlocked || !files?.length) return
    const picked = Array.from(files)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!preparationQueue.current) {
      const sdk = createArkmeSdk(), generation = generationRef.current
      const selectedAccount = accountKey
      preparationQueue.current = new AttachmentPreparationQueue({
        get: () => attachmentsRef.current,
        update: change => { const next = [...change(attachmentsRef.current)]; attachmentsRef.current = next; setAttachments(next) },
        current: () => { const current = arkmeAuthStore.getSnapshot().auth; return generationRef.current === generation && current?.status === 'authenticated' && `${current.environment}:${current.userId}` === selectedAccount },
        policy: signal => sdk.fileCapabilities(signal),
        stage: (file, signal) => sdk.stageFile(file, { signal, ...(auth?.status === 'authenticated' ? { expectedUserId: auth.userId } : {}) }),
        discard: file => sdk.removeLocalFile(file.fileRef),
      })
    }
    try { preparationQueue.current.add(picked) }
    catch (error) { onError(error instanceof Error ? error.message : tr('附件准备失败，请重试')) }
  }

  const send = () => {
    if (replyTarget?.kind === 'thought' && !replyTarget.thought.replyTargetRef) { onError(tr('暂时无法回复 Arko，输入内容会保留')); return }
    const pendingAttachments = attachmentsRef.current
    const serializedDraft = serializeArkmeComposerDraft({ text: textRef.current, mentions: mentionsRef.current,
      emojis: emojisRef.current, attachments: pendingAttachments, ...(markdownRef.current === undefined ? {} : { markdown: markdownRef.current }) })
    const normalizedText = serializedDraft.textFormat === 'markdown' ? serializedDraft.text : serializedDraft.text.trim()
    const fileRefs = pendingAttachments.flatMap(attachment => attachment.localFile === undefined ? [] : [attachment.localFile.fileRef])
    if (messageCreationBlocked || arkmeAttachmentsPending(pendingAttachments) || (normalizedText === '' && fileRefs.length === 0)) return
    if (!accountKey) { onError('请先登录'); return }
    if (parentRecordUid !== undefined && parentItem.itemUid !== parentRecordUid) { onError('延展目标已变化，请重新选择'); return }
    const recordUid = crypto.randomUUID(), relationUid = crypto.randomUUID()
    const role = selfRoleSelection?.selectedRole
    try {
      detailExtensionSends.enqueue({
        accountKey, sourceKey: sourceIdentityKey ?? sourceRef, sourceRef, sourceKind, rootRecordUid,
        ...(replyTarget?.kind === 'thought' ? { thoughtReplyRef: replyTarget.thought.replyTargetRef } : {}),
        ...(replyTarget?.kind === 'extension' && replyTarget.item.privateThoughtReplyRef ? { privateThoughtReplyRef: replyTarget.item.privateThoughtReplyRef } : {}),
        parent: parentItem, messageActionRef, recordUid, relationUid, textContent: serializedDraft.text,
        textFormat: serializedDraft.textFormat,
        humanMentions: detailHumanMentionInputs(serializedDraft.mentions), botMentions: detailBotMentionInputs(serializedDraft.mentions), fileRefs,
        ...(role && selfRoleSelection ? { role: { userId: selfRoleSelection.userId, roleId: role.roleId } } : {}),
        extension: { recordUid, parentRecordUid: parentRecordUid ?? rootRecordUid, level: extensionLevel,
          ...(replyTarget?.kind === 'thought' ? { thoughtReply: { thoughtId:replyTarget.thought.id, recordUid:rootRecordUid,
            generation:replyTarget.thought.generation ?? 1, visibility:replyTarget.thought.visibility ?? 'user', content:replyTarget.thought.content } } : {}),
          ...((sourceKind === 'private_chat' || sourceKind === 'group_chat') && ((replyTarget?.kind === 'thought' && replyTarget.thought.visibility !== 'members') || replyTarget?.kind === 'extension' && replyTarget.item.privateThoughtReply === true) ? { privateThoughtReply: true } : {}),
          sourceKind: 'record_extension', senderIsMe: true,
          senderDisplayName: currentSelfProfile?.displayName || currentSelfProfile?.nickname || '我',
          ...(currentSelfProfile?.avatarRef === undefined ? {} : { senderAvatarUrl: currentSelfProfile.avatarRef }),
          ...(role === undefined ? {} : { selfRole: { roleId: role.roleId, name: role.name, ...(role.avatarRef === undefined ? {} : { avatarRef: role.avatarRef }) } }),
          title: '', textContent: serializedDraft.text, textFormat: serializedDraft.textFormat ?? 'plain',
          sendAtMillis: Date.now(), templateKind: 1, displayKind: 0, officialMark: 0,
          mediaItems: pendingAttachments.flatMap(attachment => attachment.localFile ? [{ fileKind: attachment.localFile.fileKind, fileName: attachment.localFile.fileName, size: attachment.localFile.size }] : []),
          contentBlocks: pendingAttachments.flatMap(attachment => attachment.localFile ? [localFileBlock(attachment.localFile)] : []),
        },
      })
      // Ownership transfers to the queue before this draft is released. A double click sees an empty draft.
      attachmentsRef.current = []; textRef.current = ''; mentionsRef.current = []; emojisRef.current = []; markdownRef.current = undefined
      for (const attachment of pendingAttachments) releaseArkmeComposerAttachment(attachment)
      setText(''); setMentions([]); setEmojis([]); setMarkdown(undefined); setMentionTrigger(undefined)
      setAttachments([]); setDraftPreview(undefined)
      onQueued()
      focusComposerAt(0)
    } catch (error) { onError(error instanceof Error ? error.message : '延展发送失败，内容已保留') }
  }
  const disabled = messageCreationBlocked
  const thoughtReplyUnavailable = replyTarget?.kind === 'thought' && !replyTarget.thought.replyTargetRef
  const replyName = replyTarget?.kind === 'thought' ? 'Arko' : replyTarget?.item.senderName
  const replyText = replyTarget?.kind === 'thought' ? replyTarget.thought.content : replyTarget?.item.textContent || replyTarget?.item.title || ''
  const canSend = (markdown?.source ?? text).trim() !== '' || attachments.length > 0
  return <div style={styles.extensionComposer}
    onDragOver={event => { if (!disabled && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDrop={event => { if (!disabled && event.dataTransfer.files.length > 0) { event.preventDefault(); void selectFiles(event.dataTransfer.files) } }}>
    {messageCreationBlocked && <div role="status">{messageCreationRestriction}</div>}
    <input ref={fileInputRef} type="file" multiple hidden disabled={disabled} data-arkme-detail-extension-file-input="true"
      onChange={event => selectFiles(event.currentTarget.files)} />
    {attachments.length > 0 && <div style={styles.extensionAttachmentPreview}><ArkmeAttachmentStrip
        attachments={attachments}
        disabled={disabled}
        onMove={(from, to) => { setAttachments(current => { const next = [...current]; const [item] = next.splice(from, 1); if (item !== undefined) next.splice(to, 0, item); attachmentsRef.current = next; return next }) }}
        onRemove={attachment => {
          const fileRef = attachment.localFile?.fileRef
          releaseArkmeComposerAttachment(attachment)
          if (draftPreview === attachment) setDraftPreview(undefined)
          setAttachments(current => {
            const next = current.filter(item => item !== attachment)
            attachmentsRef.current = next
            return next
          })
          if (fileRef !== undefined) void createArkmeSdk().removeLocalFile(fileRef).catch(caught => { onError(caught instanceof Error ? caught.message : '附件移除失败') })
        }}
        onPreview={attachment => { setDraftPreview(attachment) }}
      /></div>}
    <div className="arkme-detail-extension-input-bar" style={styles.extensionInputBar}>
      <style>{extensionComposerStyles}</style>
      {replyTarget && <div data-arkme-detail-reply-target={replyTarget.kind} style={{ marginBottom: 6 }}>
        <ArkmeComposerTargetPreview mode="extension" quote label={`${tr('回复')} ${replyName}`} text={replyText}
          closeLabel={tr('取消回复')} onClose={onCancelReply}/>
        {thoughtReplyUnavailable && <div role="status" data-arkme-thought-reply-unavailable style={{ padding: '4px 8px', color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('暂时无法回复 Arko，输入内容会保留')}</div>}
      </div>}
      {mentionTrigger !== undefined && <ArkmeMentionSuggestions session={mentionSession}
        style={styles.mentionSuggestions!}
        loading={mentionBots.loading || (!mentionBots.ready && !mentionBots.error)}
        error={mentionBots.error} onRetry={mentionBots.retry} onSelect={insertMentionCandidate}
        rowStyles={{ row: styles.mentionSuggestionRow!, rowActive: styles.mentionSuggestionRowActive!,
          avatar: styles.mentionSuggestionAvatar!, botAvatar: styles.mentionSuggestionBotAvatar!,
          text: styles.mentionSuggestionText!, name: styles.mentionSuggestionName!, secondary: styles.mentionSuggestionSecondary! }}
      />}
      <div className="arkme-detail-extension-input-shell" style={styles.extensionInputWrap}>
        <button data-arkme-feedback="neutral" type="button" style={{ ...styles.extensionTool, opacity: disabled ? .4 : 1 }} aria-label={tr("添加延展附件")} disabled={disabled}
          onClick={() => { fileInputRef.current?.click() }}><FileTextIcon size={18} /></button>
        <ArkmeRichComposerInput ref={inputRef} style={styles.extensionInput!} ariaLabel={replyTarget ? `${tr('回复')} ${replyName}` : tr("延展此快记")} placeholder={replyTarget ? `${tr('回复')} ${replyName}…` : tr("延展此快记...")} value={text} disabled={disabled}
          mentions={mentions} emojis={emojis} maxLength={20000} markdownEnabled={markdownEnabled} markdown={markdown}
          onTextChange={updateText} onMarkdownChange={(value, nextText, nextMentions, nextEmojis) => {
            if (disabled) return
            if (nextText !== undefined) setText(nextText)
            setMentions([...(nextMentions ?? value.mentions)])
            setEmojis([...(nextEmojis ?? [])])
            setMarkdown(value)
          }}
          onSelectionChange={updateMentionTrigger}
          onPaste={event => { const files = clipboardFiles(event.clipboardData); if (files.length > 0) { event.preventDefault(); void selectFiles(files) } }}
          onKeyDown={event => {
            if (mentionTrigger !== undefined && !event.nativeEvent.isComposing) {
              if (event.key === 'Escape') {
                event.preventDefault()
                setMentionTrigger(undefined)
                return
              }
              if (event.key === 'ArrowDown' && mentionCandidates.length > 0) {
                event.preventDefault()
                mentionSession.move(1)
                return
              }
              if (event.key === 'ArrowUp' && mentionCandidates.length > 0) {
                event.preventDefault()
                mentionSession.move(-1)
                return
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && mentionSession.rows.length > 0) {
                event.preventDefault()
                const selectedCandidate = mentionSession.activeCandidate
                if (selectedCandidate !== undefined) insertMentionCandidate(selectedCandidate)
                return
              }
            }
            if (!event.nativeEvent.isComposing && (event.key === 'Backspace' || event.key === 'Delete')) {
              const caret = deleteMentionAtSelection(event.key === 'Backspace' ? 'backward' : 'forward')
              if (caret !== undefined) {
                event.preventDefault()
                focusComposerAt(caret)
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (canSend) void send()
            }
          }} />
        {selfRoleSelection !== undefined && <ArkmeSelfRolePicker
          accountKey={selfRoleSelection.accountKey}
          userId={selfRoleSelection.userId}
          selectedRole={selfRoleSelection.selectedRole}
          {...(selfRoleSelection.selfAvatarRef === undefined ? {} : { selfAvatarRef: selfRoleSelection.selfAvatarRef })}
          onSelect={selfRoleSelection.onSelect}
          disabled={disabled}
        />}
        <ArkmeComposerSendButton
          ariaLabel={tr("发送延展")}
          disabled={disabled || thoughtReplyUnavailable || preparing || !canSend}
          shortcutHint={attachmentPreparationHint(attachments) ?? tr("Enter发送 / Shift+Enter换行")}
          onClick={() => { void send() }}
        />
      </div>
    </div>
    {draftPreview?.localFile !== undefined && <ArkmeMediaPreview
      selected={localFileBlock(draftPreview.localFile)}
      blocks={attachments.flatMap(attachment => attachment.localFile === undefined ? [] : [localFileBlock(attachment.localFile)])}
      {...(draftPreview.previewUrl === undefined ? {} : { previewUrl: draftPreview.previewUrl })}
      onSelect={block => {
        const attachment = attachments.find(item => item.localFile?.fileRef === block.localFileRef)
        if (attachment !== undefined) setDraftPreview(attachment)
      }}
      onClose={() => { setDraftPreview(undefined) }}
      openLocalFile={false}
    />}
  </div>
}

export function arkmeTimelineDetailSenderText(item: ArkmeTimelineItem, members: readonly ArkmeConversationMemberItem[] = []): string {
  const member = item.senderKind === 'bot' ? undefined : item.memberRef !== undefined
    ? members.find(member => member.memberRef === item.memberRef)
    : item.isMe ? members.find(member => member.isSelf) : undefined
  const displayName = member?.displayName.trim()
  const name = displayName && displayName !== '群成员' ? displayName : item.senderName
  return item.agentSource === undefined ? name : `${name} · ${item.agentSource.label}`
}

type ArkmeDetailExtensionLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; context: ArkmeSourceMessageExtensionContext; pageError?: string; retryFromStart?: boolean }
  | { kind: 'error'; message: string }

function detailExtensionSenderName(item: ArkmeMessageCopyLinkExtensionItem): string {
  return item.senderDisplayName.trim() || (item.sourceKind === 'agent_message' ? 'Agent' : '未知用户')
}

function detailExtensionAuthor(
  item: ArkmeMessageCopyLinkExtensionItem, personalSource: boolean, profile?: ArkmeUserProfile,
  sourceKind?: ArkmeSourceKind, conversationMembers: readonly ArkmeConversationMemberItem[] = [],
): {
  name: string; avatar: string; role?: ArkmeSelfRoleSnapshot
} {
  const role = personalSource && item.sourceKind === 'record_extension' ? item.selfRole : undefined
  if (role !== undefined) return { name: role.name, avatar: role.avatarRef ?? '', role }
  const ownRecord = personalSource && item.sourceKind === 'record_extension' && profile !== undefined
    && (item.recordOwnerUserId === undefined || item.recordOwnerUserId === profile.userId)
  const currentNameFallback = ownRecord && item.senderNameSnapshot !== true && item.senderDisplayName.trim() === '我'
  const privateOwn = sourceKind === 'private_chat' && item.senderIsMe === true && profile !== undefined
  const member = item.senderMemberRef === undefined ? undefined
    : conversationMembers.find(candidate => candidate.memberRef === item.senderMemberRef)
  const memberName = member?.displayName.trim()
  return {
    name: privateOwn || currentNameFallback
      ? profile?.nickname.trim() || profile?.displayName.trim() || detailExtensionSenderName(item)
      : memberName && memberName !== '群成员' ? memberName : detailExtensionSenderName(item),
    avatar: privateOwn ? profile?.avatarRef.trim() || member?.avatarRef?.trim() || item.senderAvatarUrl || ''
      : member?.avatarRef?.trim() || arkmePersonalAvatarRef({ isMe: ownRecord,
      ...(item.senderAvatarUrl === undefined ? {} : { avatarRef: item.senderAvatarUrl }),
    }, profile) || '',
  }
}

function detailExtensionTimelineItem(item: ArkmeMessageCopyLinkExtensionItem, author: ReturnType<typeof detailExtensionAuthor>): ArkmeTimelineItem {
  const avatar = author.avatar
  const mediaOnlyUnavailable = item.mediaUnavailable === true && item.mediaItems.length > 0
    && item.title.trim() === '' && item.textContent.trim() === '' && (item.contentBlocks?.length ?? 0) === 0
  return {
 ...(item.thoughtReply ? { thoughtReply:item.thoughtReply } : {}),
 ...(item.privateThoughtReplyRef ? { privateThoughtReplyRef:item.privateThoughtReplyRef } : {}),
 ...(item.privateThoughtReply ? { privateThoughtReply:true } : {}),
    itemUid: item.recordUid,
    ...(item.recordOwnerUserId === undefined ? {} : { recordOwnerUserId: item.recordOwnerUserId }),
    ...(item.sequence === undefined ? {} : { sequence: item.sequence }),
    senderName: author.name,
    isMe: false,
    sendAtMillis: item.sendAtMillis,
    title: item.title,
    textContent: item.textContent,
    textFormat: item.textFormat ?? 'plain',
    ...(item.mentions === undefined ? {} : { mentions: item.mentions }),
    status: 1,
    templateKind: item.templateKind,
    displayKind: item.displayKind,
    ...(item.contentBlocks === undefined ? {} : { contentBlocks: item.contentBlocks }),
    ...(mediaOnlyUnavailable ? { mediaUnavailable: true } : {}),
    ...(author.role === undefined ? {} : { selfRole: author.role }),
    ...(avatar !== '' && !/^(https?:|data:|blob:)/iu.test(avatar) ? { avatarRef: avatar } : {}),
  }
}

function DetailExtensionAvatar({ author, size = 32 }: { author: ReturnType<typeof detailExtensionAuthor>; size?: number }) {
  const { name, avatar, role } = author
  if (role !== undefined) return <ArkmeUserAvatar
    {...(role.avatarRef === undefined ? {} : { avatarRef: role.avatarRef })}
    fallback={arkmeSelfRoleAvatarFallback(role)} size={size} label={tr("延展作者头像")} />
  if (/^(https?:|data:|blob:)/iu.test(avatar)) {
    return <span style={{ ...styles.extensionContextAvatarFallback, width: size, height: size }} aria-hidden>
      <img src={avatar} alt="" draggable={false} style={styles.extensionContextAvatarImage} />
    </span>
  }
  if (avatar !== '') return <ArkmeUserAvatar avatarRef={avatar} size={size} label={tr("延展作者头像")} />
  return <span style={{ ...styles.extensionContextAvatarFallback, width: size, height: size }} aria-hidden>{[...name][0] ?? '?'}</span>
}

function orderedDetailExtensions(
  extensions: readonly ArkmeMessageCopyLinkExtensionItem[],
  rootRecordUid: string,
): Array<{ item: ArkmeMessageCopyLinkExtensionItem; nested: boolean }> {
  const newestFirst = [...extensions].sort((left, right) => right.sendAtMillis - left.sendAtMillis)
  const direct = newestFirst.filter(item => item.parentRecordUid === rootRecordUid
    || (item.parentRecordUid === undefined && item.level <= 2))
  const directUids = new Set(direct.map(item => item.recordUid))
  const result: Array<{ item: ArkmeMessageCopyLinkExtensionItem; nested: boolean }> = []
  const used = new Set<string>()
  for (const item of direct) {
    result.push({ item, nested: false })
    used.add(item.recordUid)
    for (const child of newestFirst.filter(candidate => candidate.parentRecordUid === item.recordUid)) {
      result.push({ item: child, nested: true })
      used.add(child.recordUid)
    }
  }
  for (const item of newestFirst) {
    if (used.has(item.recordUid)) continue
    result.push({ item, nested: !directUids.has(item.recordUid) && item.level > 2 })
  }
  return result
}

function DetailExtensionParent({ parent, onOpen }: {
  parent: NonNullable<ArkmeTimelineItem['extensionParent']>
  onOpen?: ((parent: NonNullable<ArkmeTimelineItem['extensionParent']>) => void) | undefined
}) {
  if (parent.quote || parent.quoteState === 'unavailable') return <ArkmeQuotePreview parent={parent} onOpen={onOpen ? () => onOpen(parent) : undefined} />
  const text = parent.textContent.trim() || parent.title.trim()
  const attachmentText = (parent.contentBlocks ?? []).map(block => block.fileName.trim()).filter(Boolean).join('、')
  const preview = text || attachmentText || tr('查看原始快记')
  return <button type="button" data-arkme-feedback="neutral" style={{ ...styles.extensionParent,
    ...(onOpen === undefined ? { cursor: 'default' } : {}) }}
    data-arkme-detail-extension-parent={parent.itemUid} disabled={onOpen === undefined}
    aria-label={tr('查看延展源：{v0}', { v0: preview })} onClick={() => onOpen?.(parent)}>
    <span style={{ flex: 1, minWidth: 0, ...styles.extensionParentText }}><ArkmeRichText text={preview} presentation="preview" highlightMentions /></span>
    {onOpen !== undefined && <CaretRight size={13} aria-hidden style={{ flex: 'none' }} />}
  </button>
}

function DetailExtensionContext({
  rootItem,
  state, optimistic, selectedRecordUid, sourceRef, sourceIdentityKey, shareWebsite, onMessageCopyLinkOpen, onMentionClick, isMentionClickable, onRetry, onSelect,
  personalSource, currentSelfProfile, sourceKind, conversationMembers, sendTasks, onReplyThought, selectedThoughtId, canReply,
}: {
  state: ArkmeDetailExtensionLoadState
  rootItem: ArkmeTimelineItem
  optimistic: readonly ArkmeMessageCopyLinkExtensionItem[]
  sendTasks: readonly DetailExtensionSend[]
  selectedRecordUid?: string | undefined
  sourceRef?: string | undefined
  sourceIdentityKey?: string | undefined
  shareWebsite?: string | undefined
  onMessageCopyLinkOpen?: ((sid: string) => void) | undefined
  onMentionClick?: (mentionText: string, mentionTarget?: ArkmeTimelineMentionTarget) => void
  isMentionClickable?: (mentionText: string, mentionTarget?: ArkmeTimelineMentionTarget) => boolean
  personalSource: boolean
  currentSelfProfile?: ArkmeUserProfile
  sourceKind?: ArkmeSourceKind | undefined
  conversationMembers?: readonly ArkmeConversationMemberItem[] | undefined
  onRetry: () => void
  onSelect: (item: ArkmeMessageCopyLinkExtensionItem) => void
  onReplyThought: (thought: ArkmeRecordThought) => void
  selectedThoughtId?: string | undefined
  canReply: boolean
}) {
  const quoteThreads = useMessageQuoteThreads()
  const thoughtReplies = useRecordThoughtReplySummary(rootItem)
  const continuations = useThoughtContinuations(sourceRef, rootItem.messageActionRef, sendTasks, rootItem.itemUid, sourceIdentityKey)
  const context = state.kind === 'success' ? state.context : undefined
  const byUid = new Map<string, ArkmeMessageCopyLinkExtensionItem>()
  for (const item of optimistic) byUid.set(item.recordUid, item)
  for (const item of context?.extensions ?? []) {
    const pending = byUid.get(item.recordUid)
    byUid.set(item.recordUid, item.selfRole === undefined && pending?.selfRole !== undefined
      ? { ...item, selfRole: pending.selfRole } : item)
  }
  const extensions = [...byUid.values()]
  const repliesByHuman = new Map<string, typeof continuations.items>()
  for (const reply of continuations.items) {
    const rows = repliesByHuman.get(reply.replyRecordUid) ?? []
    rows.push(reply); repliesByHuman.set(reply.replyRecordUid, rows)
  }
  const pendingReplies = new Set(continuations.pendingReplyRecordUids)
  const pendingCount = continuations.supported ? extensions.filter(row => pendingReplies.has(row.recordUid) && !repliesByHuman.has(row.recordUid)).length : 0
  const hasInlineStatus = pendingCount > 0 || continuations.items.some(row => row.status !== 'ready')
  const extensionCount = Math.max(context?.extensionCount ?? 0, extensions.length) + thoughtReplies.count + continuations.items.length + pendingCount
  const contextError = state.kind === 'error' ? state.message : state.kind === 'success' ? state.pageError : undefined
  if (extensionCount === 0 && !thoughtReplies.hasContent && !contextError) return null
  return <section style={styles.extensionContext} aria-label={tr("快记延展列表")}>
    {extensionCount > 0 && <div style={styles.extensionContextTitle} data-arkme-note-extension-count="true">{tr("共")}{extensionCount}{continuations.nextCursor ? '+' : ''}{tr("条延展")}</div>}
    <div style={styles.extensionContextList}>
      {thoughtReplies.hasContent && <div data-arkme-detail-scroll-anchor="original-thought">
        <RecordThoughtContent item={rootItem} embedded selectedThoughtId={selectedThoughtId} onReply={canReply ? onReplyThought : undefined}/>
      </div>}
      {orderedDetailExtensions(extensions, context?.parentRecordUid ?? '').map(({ item: extension, nested }) => {
      const author = detailExtensionAuthor(extension, personalSource, currentSelfProfile, sourceKind, conversationMembers)
      const timelineItem = detailExtensionTimelineItem(extension, author)
      const missingMedia = extension.mediaUnavailable === true && extension.mediaItems.length > 0
        && (extension.title.trim() !== '' || extension.textContent.trim() !== '' || (extension.contentBlocks?.length ?? 0) > 0)
      const selected = extension.recordUid === selectedRecordUid
      const pendingSend = sendTasks.some(task => task.recordUid === extension.recordUid && task.state !== 'sent')
      return <Fragment key={extension.recordUid}><div style={{
        ...styles.extensionContextRow,
        ...(selected ? styles.extensionContextRowSelected : {}),
        ...(nested ? { marginLeft: 30 } : {}),
      }}
        role={canReply ? 'button' : undefined} tabIndex={pendingSend || !canReply ? -1 : 0} aria-pressed={selected}
        aria-label={canReply ? `${tr('回复')} ${author.name}` : undefined}
        data-arkme-note-extension-item={extension.recordUid}
        data-arkme-detail-scroll-anchor={`human:${extension.recordUid}`}
        onClick={event => { if (canReply && !pendingSend && detailReplyClickAllowed(event)) onSelect(extension) }}
        onKeyDown={event => { if (canReply && !pendingSend) activateDetailReplyKey(event, () => onSelect(extension)) }}>
        <TeamRepresentationAvatar value={extension.representation}><DetailExtensionAvatar author={author} size={nested ? 28 : 32} /></TeamRepresentationAvatar>
        <div style={styles.extensionContextBody}>
          <div style={styles.extensionContextHead}>
            <span style={styles.extensionContextName}>{author.name}{extension.privateThoughtReply && <span style={{ fontSize:11, fontWeight:400, color:arkmeTheme.tertiary, marginLeft:8 }}>{tr('仅自己可见')}</span>}</span>
            <span style={styles.extensionContextTime}>{[dateLabel(extension.sendAtMillis), timeLabel(extension.sendAtMillis)].filter(Boolean).join(' ')}</span>
          </div>
          {(() => {
            const replySource = extension.parentRecordUid ? byUid.get(extension.parentRecordUid) : undefined
            const replySourceAuthor = replySource ? detailExtensionAuthor(replySource, personalSource, currentSelfProfile, sourceKind, conversationMembers) : undefined
            const wholeReplyParent = replySource ? { itemUid: replySource.recordUid, senderName: replySourceAuthor!.name,
              title: replySource.title, textContent: replySource.textContent, textFormat: replySource.textFormat ?? 'plain' as const } : undefined
            const parent = extension.thoughtReply && !replySource ? { itemUid: extension.thoughtReply.thoughtId, senderName:'Arko', title:'', textContent:extension.thoughtReply.content, textFormat:'plain' as const } : quoteThreads.store?.commentParent(rootItem, extension)
              ?? (extension.quote || extension.quoteState === 'unavailable' ? { itemUid: extension.parentRecordUid ?? rootItem.itemUid,
                senderName: replySourceAuthor?.name ?? rootItem.senderName, title: '', textContent: '', ...(extension.quote ? { quote: extension.quote } : {}),
                ...(extension.quoteState ? { quoteState: extension.quoteState } : {}) } : wholeReplyParent)
            return parent ? <div data-arkme-comment-quote style={{ margin: '2px 0 8px' }}><ArkmeQuotePreview parent={parent} wholeMessageText={parent.textContent || parent.title}/></div> : null
          })()}
          <ArkmeMessageContent
            presentation="detail"
            item={timelineItem}
            highlightMentions
            {...(sourceRef === undefined ? {} : { sourceRef })}
            {...(sourceIdentityKey === undefined ? {} : { sourceIdentityKey })}
            {...(shareWebsite === undefined ? {} : { shareWebsite })}
            {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
            {...(onMentionClick === undefined ? {} : { onMentionClick })}
            {...(isMentionClickable === undefined ? {} : { isMentionClickable })}
          />
          {sendTasks.filter(task => (task.result?.recordUid ?? task.recordUid) === extension.recordUid).map(task => <DetailExtensionSendStatus key={task.recordUid} task={task} />)}
          {missingMedia && <span data-arkme-missing-extension-media style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 5, color: arkmeTheme.tertiary, fontSize: 12 }}>
            <FileTextIcon size={13} aria-hidden />{tr('附件暂不可用')}
          </span>}
        </div>
      </div>
      {(() => {
        const replies: ArkmeRecordThought[] = [...(repliesByHuman.get(extension.recordUid) ?? [])]
        if (!replies.length && continuations.supported && pendingReplies.has(extension.recordUid)) replies.push({
          id: `pending:${extension.recordUid}`, recordUid: rootItem.itemUid, biz: 2, status: 'generating', content: '',
          visibility: extension.privateThoughtReply ? 'user' : personalSource ? 'user' : 'members',
        })
        return replies.length ? <div data-arkme-detail-scroll-anchor={`ai:${extension.recordUid}`} data-arkme-detail-continuation-slot={extension.recordUid}>
          <RecordThoughtContent item={rootItem} embedded items={replies} onReply={canReply ? onReplyThought : undefined}
            selectedThoughtId={selectedThoughtId} refreshError={continuations.error} onRefresh={continuations.refresh}
            onRetry={replies.some(thought => continuations.items.find(reply => reply.id === thought.id)?.canRetry)
              ? thought => { if (continuations.items.find(reply => reply.id === thought.id)?.canRetry) continuations.retry(thought.id) } : undefined}
            retryingId={continuations.retryingId}/>
        </div> : null
      })()}
      </Fragment>
    })}</div>
    {continuations.error && !hasInlineStatus && <div role="status" style={styles.extensionContextStatus}><span>{continuations.error}</span>
      <button type="button" style={styles.extensionContextRetry} onClick={continuations.refresh}>{tr('重试')}</button></div>}
    {continuations.nextCursor && <button type="button" style={styles.extensionContextRetry} onClick={continuations.loadMore}>{tr('查看更多回复')}</button>}
    {contextError && <div role="alert" style={styles.extensionContextStatus}>
      <span>{contextError}</span><button data-arkme-feedback="neutral" type="button" style={styles.extensionContextRetry} onClick={onRetry}>{tr('重试')}</button>
    </div>}
    {state.kind === 'success' && state.context.nextCursor && !state.pageError && <div role="status" style={styles.extensionContextStatus}>{tr('正在加载更多延展…')}</div>}
  </section>
}

function relatedQuickNoteErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

function relatedQuickNoteReferenceExpired(error: unknown): boolean {
  return error instanceof ArkmeClientError && error.body.code === 'related-quick-note-ref-expired'
}

export function ArkmeTimelineDetailDrawer({
  item, sourceBadge, sourceRef, sourceIdentityKey, sourceKind, selfTopicPath, selfTopicSource, onOpenSelfTopic, onOpenExtensionParent, onBackToExtension, currentSelfProfile, conversationMembers, canExtend = true, showOriginal, onClose, onToggleOriginal, shareWebsite, onMessageCopyLinkOpen, onExtensionSent, onToast,
  onOpenPrivateChatMember, selfRoleSelection, messageCreationBlocked = false, messageCreationRestriction = '',
  detailLoading = false, detailError, onRetryDetail,
}: {
  sourceBadge?: ReactNode
  item: ArkmeTimelineItem
  sourceRef?: string | undefined
  sourceIdentityKey?: string | undefined
  canExtend?: boolean
  sourceKind?: ArkmeSourceKind | undefined
  selfTopicPath?: string | undefined
  selfTopicSource?: ArkmeSourceItem | undefined
  onOpenSelfTopic?: ((source: ArkmeSourceItem) => void) | undefined
  onOpenExtensionParent?: ((parent: NonNullable<ArkmeTimelineItem['extensionParent']>) => void) | undefined
  onBackToExtension?: (() => void) | undefined
  currentSelfProfile?: ArkmeUserProfile | undefined
  selfRoleSelection?: DetailSelfRoleSelection | undefined
  conversationMembers?: readonly ArkmeConversationMemberItem[] | undefined
  showOriginal: boolean
  onClose: () => void
  onToggleOriginal: () => void
  shareWebsite?: string
  onMessageCopyLinkOpen?: (sid: string) => void
  onExtensionSent?: (result: ArkmeSourceMessageExtendResult) => void
  onToast?: (message: string) => void
  onOpenPrivateChatMember?: (member: ArkmeConversationMemberItem) => void
  messageCreationBlocked?: boolean
  messageCreationRestriction?: string
  detailLoading?: boolean
  detailError?: string | undefined
  onRetryDetail?: () => void
}) {
  useArkmeLocale()
  const [editHistoryTarget, setEditHistoryTarget] = useState<string>()
  const [relatedView, setRelatedView] = useState<ArkmeRelatedDrawerView>('source-detail')
  const [relatedState, setRelatedState] = useState<ArkmeRelatedQuickNotesLoadState>({ kind: 'idle' })
  const [relatedDetailState, setRelatedDetailState] = useState<ArkmeRelatedQuickNoteDetailState>({ kind: 'idle' })
  const listAbortRef = useRef<AbortController>()
  const detailAbortRef = useRef<AbortController>()
  const extensionAbortRef = useRef<AbortController>()
  const [extensionState, setExtensionState] = useState<ArkmeDetailExtensionLoadState>({ kind: 'idle' })
  const extensionStateRef = useRef(extensionState)
  extensionStateRef.current = extensionState
  const [optimisticExtensions, setOptimisticExtensions] = useState<ArkmeMessageCopyLinkExtensionItem[]>([])
  const [replySelection, setReplySelection] = useState<{ scopeKey: string; target: DetailReplyTarget }>()
  const [replyFocusRevision, setReplyFocusRevision] = useState(0)
  const [memberProfile, setMemberProfile] = useState<ArkmeConversationMemberItem>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollAnchorRef = useRef<ReturnType<typeof observeDetailScrollAnchor>>()
  const quoteThreads = useMessageQuoteThreads()
  const commentJump = useRef('')
  const scrollTopByViewRef = useRef<Record<ArkmeRelatedDrawerView, number>>({
    'source-detail': 0,
    'related-list': 0,
    'related-detail': 0,
  })
  const messageActionRef = item.messageActionRef?.trim() ?? ''
  const normalizedSourceRef = sourceRef?.trim() ?? ''
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const replyScopeKey = JSON.stringify([accountKey, sourceIdentityKey ?? normalizedSourceRef, item.itemUid])
  const replyTarget = replySelection?.scopeKey === replyScopeKey ? replySelection.target : undefined
  const selectedExtensionRecordUid = replyTarget?.kind === 'extension' ? replyTarget.item.itemUid : undefined
  const selectReply = (target: DetailReplyTarget | undefined) => {
    setReplySelection(target ? { scopeKey: replyScopeKey, target } : undefined)
    setReplyFocusRevision(value => value + 1)
  }
  const sourceSendTasks = useDetailExtensionSends(accountKey, sourceIdentityKey ?? normalizedSourceRef)
  const extensionSendTasks = sourceSendTasks.filter(task => task.rootRecordUid === item.itemUid)
  const sentNotifications = useRef(new Set<string>())
  const historyTarget = `${normalizedSourceRef}:${item.itemUid}`
  const historyOpen = editHistoryTarget === historyTarget && messageActionRef !== ''
  useLayoutEffect(() => {
    if (historyOpen || relatedView !== 'source-detail' || !bodyRef.current) return
    const anchor = observeDetailScrollAnchor(bodyRef.current)
    scrollAnchorRef.current = anchor
    return () => { anchor(); if (scrollAnchorRef.current === anchor) scrollAnchorRef.current = undefined }
  }, [replyScopeKey, historyOpen, relatedView])
  const interactionJump = useSyncExternalStore(arkoInteractionJump.subscribe, arkoInteractionJump.snapshot, arkoInteractionJump.snapshot)
  useEffect(() => {
    const request = interactionJump, body = bodyRef.current
    if (!request || !body || request.scope !== accountKey || request.rootUid !== item.itemUid
      || String(request.recordOwnerUserId)!==String(recordOwnerId(item.recordOwnerUserId ?? (item.isMe&&auth?.status==='authenticated' ? auth.userId : undefined)))
      || request.sourceKey !== (sourceIdentityKey ?? normalizedSourceRef) || historyOpen || relatedView !== 'source-detail') return
    const expiry = setTimeout(() => arkoInteractionJump.consume(request.revision), Math.max(0,request.expiresAt-Date.now()))
    let frame: number | undefined
    const align = () => {
      frame = undefined
      const target = request.replyId
        ? [...body.querySelectorAll<HTMLElement>('[data-arkme-thought-reply]')].find(node => node.dataset.arkmeThoughtReply === request.replyId)
        : [...body.querySelectorAll<HTMLElement>('[data-arkme-thought-reply]')].find(node => node.dataset.arkmeThoughtReply === request.thought?.id)
      if (!target) return
      body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 12
      scrollAnchorRef.current?.rebase()
      arkoInteractionJump.consume(request.revision)
    }
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(align) }
    const cancel = () => arkoInteractionJump.consume(request.revision)
    const observer = new MutationObserver(schedule); observer.observe(body, { childList: true, subtree: true })
    body.addEventListener('wheel',cancel,{passive:true}); body.addEventListener('touchmove',cancel,{passive:true})
    schedule()
    return () => { clearTimeout(expiry); observer.disconnect(); if(frame!==undefined) cancelAnimationFrame(frame); body.removeEventListener('wheel',cancel); body.removeEventListener('touchmove',cancel) }
  }, [interactionJump, accountKey, item.itemUid, item.recordOwnerUserId, item.isMe, sourceIdentityKey, normalizedSourceRef, historyOpen, relatedView])
  const quickNoteDetailsSupported = item.quickNoteDetailsSupported !== false
  const extensionParent = extensionState.kind === 'success'
    ? extensionState.context.extensionParent ?? item.extensionParent : item.extensionParent
  const loadRelated = useCallback(() => {
    listAbortRef.current?.abort()
    if (!quickNoteDetailsSupported || normalizedSourceRef === '' || messageActionRef === '') {
      setRelatedState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    listAbortRef.current = controller
    setRelatedState(current => current.kind === 'success' ? current : { kind: 'loading' })
    void loadRelatedQuickNotes('source.related-quick-notes.from-message', {
      sourceRef: normalizedSourceRef,
      messageActionRef,
    }, controller.signal).then(list => {
      if (controller.signal.aborted || listAbortRef.current !== controller) return
      setRelatedState(list.items.length === 0 ? { kind: 'empty' } : { kind: 'success', list })
    }).catch(error => {
      if (controller.signal.aborted || listAbortRef.current !== controller) return
      setRelatedState({ kind: 'error', message: relatedQuickNoteErrorMessage(error, '相关快记加载失败') })
    })
  }, [messageActionRef, normalizedSourceRef, quickNoteDetailsSupported])
  const loadExtensionContext = useCallback((resume?: ArkmeSourceMessageExtensionContext) => {
    extensionAbortRef.current?.abort()
    if (!quickNoteDetailsSupported || normalizedSourceRef === '' || messageActionRef === '') {
      setExtensionState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    extensionAbortRef.current = controller
    setExtensionState(current => current.kind === 'success' ? current : { kind: 'loading' })
    const retained = extensionStateRef.current
    const retainedContext = retained.kind === 'success' && retained.context.parentRecordUid === item.itemUid ? retained.context : undefined
    const atomic = retainedContext !== undefined && resume === undefined
    let published = resume
    if (resume) setExtensionState({ kind: 'success', context: resume })
    void readDetailExtensionPages({ parentRecordUid: item.itemUid, signal: controller.signal, initial: resume, atomic,
      loadPage: pageCursor => callArkme<ArkmeSourceMessageExtensionContext>('source.message-extension.context', {
        sourceRef: normalizedSourceRef, messageActionRef, paginated: true, ...(pageCursor ? { pageCursor } : {}),
      }, controller.signal),
      onPage: context => {
        if (controller.signal.aborted || extensionAbortRef.current !== controller) return
        published = context
        setExtensionState({ kind: 'success', context })
      },
    }).catch(error => {
      if (controller.signal.aborted || extensionAbortRef.current !== controller) return
      const message = relatedQuickNoteErrorMessage(error, published ? '更多延展加载失败' : '延展加载失败')
      const visible = atomic ? isArkmeTransientReadFailure(error) ? retainedContext : undefined
        : published ?? (isArkmeTransientReadFailure(error) ? retainedContext : undefined)
      setExtensionState(visible ? { kind: 'success', context: visible, pageError: message, retryFromStart: atomic } : { kind: 'error', message })
    })
  }, [item.itemUid, messageActionRef, normalizedSourceRef, quickNoteDetailsSupported])
  useEffect(() => {
    if (extensionState.kind === 'success') quoteThreads.store?.acceptContext(item, extensionState.context)
  }, [quoteThreads.store, item, extensionState])
  useEffect(() => subscribeMessageQuoteInvalidations(changedSource => {
    if (changedSource && sourceIdentityKey && changedSource !== sourceIdentityKey) return
    loadExtensionContext()
  }), [sourceIdentityKey, loadExtensionContext])
  useEffect(() => {
    const request = quoteThreads.store?.request
    if (!request || request.key !== quoteThreadKey(item) || historyOpen || extensionState.kind !== 'success') return
    const key = `${request.key}:${request.revision}`
    if (commentJump.current === key) return
    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current, target = body?.querySelector<HTMLElement>('[data-arkme-note-extension-count]')
      if (!body || !target) return
      body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 12
      scrollAnchorRef.current?.rebase()
      // One click owns one alignment. The viewport anchor handles late layout;
      // a delayed related-note response must never override subsequent user scrolling.
      commentJump.current = key
    })
    return () => cancelAnimationFrame(frame)
  }, [quoteThreads.revision, quoteThreads.store, item, historyOpen, extensionState, relatedState.kind])
  useEffect(() => {
    for (const task of extensionSendTasks) {
      const key = `${task.accountKey}:${task.recordUid}`
      if (task.result && !sentNotifications.current.has(key)) {
        sentNotifications.current.add(key)
        setOptimisticExtensions(current => [task.result!.extension, ...current.filter(item => item.recordUid !== task.result!.recordUid)])
        onExtensionSent?.(task.result)
        loadExtensionContext()
      }
      const canonical = extensionState.kind === 'success' ? extensionState.context.extensions.find(item => item.recordUid === task.recordUid) : undefined
      if (canonical) detailExtensionSends.observe(task, canonical)
    }
  }, [extensionSendTasks, extensionState, onExtensionSent, loadExtensionContext])
  const loadRelatedDetail = useCallback((relatedItem: ArkmeRelatedQuickNoteItem) => {
    detailAbortRef.current?.abort()
    if (normalizedSourceRef === '') return
    const controller = new AbortController()
    detailAbortRef.current = controller
    setRelatedDetailState({ kind: 'loading' })
    void callArkme<ArkmeRelatedQuickNoteDetailDto>('source.related-quick-note.detail', {
      sourceRef: normalizedSourceRef,
      relatedRef: relatedItem.relatedRef,
    }, controller.signal).then(detail => {
      if (controller.signal.aborted || detailAbortRef.current !== controller) return
      setRelatedDetailState({ kind: 'success', item: relatedItem, detail })
    }).catch(error => {
      if (controller.signal.aborted || detailAbortRef.current !== controller) return
      if (relatedQuickNoteReferenceExpired(error)) {
        setRelatedDetailState({ kind: 'idle' })
        setRelatedView('related-list')
        loadRelated()
        return
      }
      setRelatedDetailState({
        kind: 'error', item: relatedItem,
        message: relatedQuickNoteErrorMessage(error, '快记详情加载失败'),
      })
    })
  }, [loadRelated, normalizedSourceRef])
  useEffect(() => {
    listAbortRef.current?.abort()
    detailAbortRef.current?.abort()
    extensionAbortRef.current?.abort()
    setEditHistoryTarget(undefined)
    setRelatedView('source-detail')
    setRelatedState({ kind: 'idle' })
    setRelatedDetailState({ kind: 'idle' })
    setExtensionState({ kind: 'idle' })
    setOptimisticExtensions([])
    setReplySelection(undefined)
    setReplyFocusRevision(0)
    setMemberProfile(undefined)
    scrollTopByViewRef.current = { 'source-detail': 0, 'related-list': 0, 'related-detail': 0 }
    return () => {
      listAbortRef.current?.abort()
      detailAbortRef.current?.abort()
      extensionAbortRef.current?.abort()
    }
  }, [item.itemUid, sourceIdentityKey ?? normalizedSourceRef, quickNoteDetailsSupported])
  useEffect(() => {
    // Refresh owner data with current access refs without resetting the open detail view.
    loadRelated()
    loadExtensionContext()
  }, [item.itemUid, sourceIdentityKey, loadExtensionContext, loadRelated])
  useEffect(() => {
    if (bodyRef.current !== null) bodyRef.current.scrollTop = historyOpen ? 0 : scrollTopByViewRef.current[relatedView]
  }, [relatedView, historyOpen])
  const navigateRelated = (nextView: ArkmeRelatedDrawerView) => {
    if (bodyRef.current !== null) scrollTopByViewRef.current[relatedView] = bodyRef.current.scrollTop
    setRelatedView(nextView)
  }
  const closeDrawer = () => {
    listAbortRef.current?.abort()
    detailAbortRef.current?.abort()
    extensionAbortRef.current?.abort()
    onClose()
  }
  const mentionOpensMemberProfile = useCallback((mentionText: string, mentionTarget?: ArkmeTimelineMentionTarget): boolean => (
    sourceKind === 'group_chat'
    && arkmeMemberForMention(mentionText, conversationMembers ?? [], mentionTarget) !== undefined
  ), [conversationMembers, sourceKind])
  const openMentionMemberProfile = useCallback((mentionText: string, mentionTarget?: ArkmeTimelineMentionTarget) => {
    if (sourceKind !== 'group_chat') return
    const member = arkmeMemberForMention(mentionText, conversationMembers ?? [], mentionTarget)
    if (member === undefined) return
    setMemberProfile(member)
  }, [conversationMembers, sourceKind])
  const openPrivateFromProfile = useCallback(() => {
    if (memberProfile === undefined) return
    onOpenPrivateChatMember?.(memberProfile)
    setMemberProfile(undefined)
  }, [memberProfile, onOpenPrivateChatMember])
  const backRelated = () => {
    if (relatedView === 'related-detail') detailAbortRef.current?.abort()
    navigateRelated(relatedDrawerBackTarget(relatedView))
  }
  const textContent = showOriginal && item.aiPolish?.originalText !== undefined ? item.aiPolish.originalText
    : item.aiPolish?.state === 'polished' && item.aiPolish.polishedText !== undefined ? item.aiPolish.polishedText : item.textContent
  const canToggle = item.aiPolish?.state === 'polished' && item.aiPolish.originalText !== undefined && item.aiPolish.polishedText !== undefined
  const personalSource = sourceKind === 'send_to_self' || sourceKind === 'topic' || sourceKind === 'default_category'
  const publicationTarget = item.isMe && quickNoteDetailsSupported && (personalSource || sourceKind === 'private_chat' || sourceKind === 'group_chat') && normalizedSourceRef && messageActionRef ? { source: { sourceRef: normalizedSourceRef, messageActionRef, itemUid: item.itemUid } } : undefined
  const privateOwnCurrentName = sourceKind === 'private_chat' && item.isMe && item.senderKind !== 'bot'
    && currentSelfProfile !== undefined
  const currentNameFallback = personalSource && item.isMe && item.avatarSnapshot === true
    && item.senderNameSnapshot !== true && currentSelfProfile !== undefined
  const selfRole = sourceKind === undefined ? undefined : arkmeSelfRoleForPresentation(item, sourceKind)
  const authorName = selfRole?.name ?? (privateOwnCurrentName || currentNameFallback
    ? currentSelfProfile?.nickname.trim() || currentSelfProfile?.displayName.trim() || item.senderName
    : arkmeTimelineDetailSenderText(item, conversationMembers))
  const authorAvatarRef = personalSource ? arkmePersonalAvatarRef(item, currentSelfProfile) : item.avatarRef
  const roleAvatarFallback = selfRole === undefined ? undefined : arkmeSelfRoleAvatarFallback(selfRole)
  const topicTitle = selfTopicPath?.trim() || item.selfTopic?.title?.trim() || tr("未指定主题")
  const canOpenTopic = selfTopicSource?.kind === 'topic' && onOpenSelfTopic !== undefined
  // Only timeline bubbles omit a redundant current-topic badge. A standalone
  // detail must retain its source identity regardless of the entry point.
  const showTopicBadge = personalSource
  const extensionFooter = !quickNoteDetailsSupported || !canExtend || normalizedSourceRef === '' || messageActionRef === '' ? undefined : <DetailExtensionComposer
    key={replyScopeKey}
    sourceRef={normalizedSourceRef}
    sourceIdentityKey={sourceIdentityKey}
    sourceKind={sourceKind}
    {...(personalSource && selfRoleSelection !== undefined ? { selfRoleSelection } : {})}
    conversationMembers={conversationMembers}
    messageActionRef={messageActionRef}
    rootRecordUid={item.itemUid}
    parentItem={selectedExtensionRecordUid === undefined ? item : (() => {
      const selected = [...(extensionState.kind === 'success' ? extensionState.context.extensions : []), ...optimisticExtensions, ...extensionSendTasks.map(task => task.extension)].find(extension => extension.recordUid === selectedExtensionRecordUid)
      return selected ? detailExtensionTimelineItem(selected, detailExtensionAuthor(selected, personalSource, currentSelfProfile, sourceKind, conversationMembers)) : item
    })()}
    extensionLevel={selectedExtensionRecordUid === undefined ? 2 : 3}
    currentSelfProfile={currentSelfProfile}
    messageCreationBlocked={messageCreationBlocked}
    messageCreationRestriction={messageCreationRestriction}
    {...(selectedExtensionRecordUid === undefined ? {} : { parentRecordUid: selectedExtensionRecordUid })}
    targetKey={replyScopeKey}
    replyTarget={replyTarget}
    replyFocusRevision={replyFocusRevision}
    onCancelReply={() => selectReply(undefined)}
    onQueued={() => selectReply(undefined)}
    onError={message => { onToast?.(message) }}
  />
  if (relatedView === 'related-list') {
    const total = relatedState.kind === 'success' ? relatedState.list.total : 0
    return <ArkmeDetailShell title={tr("{v0} 条相关快记", { v0: String(total) })} label={tr("相关快记列表")}
      onClose={closeDrawer} onBack={backRelated} backLabel={tr("返回快记详情")} bodyRef={bodyRef} footer={extensionFooter}>
      <div>
        <ArkmeRelatedQuickNotesList state={relatedState}
          onRetry={loadRelated}
          onSelect={relatedItem => {
            navigateRelated('related-detail')
            loadRelatedDetail(relatedItem)
          }} />
      </div>
    </ArkmeDetailShell>
  }
  if (relatedView === 'related-detail') {
    return <ArkmeDetailShell title={tr("相关快记详情")} label={tr("相关快记详情")}
      onClose={closeDrawer} onBack={backRelated} backLabel={tr("返回相关快记列表")} bodyRef={bodyRef} footer={extensionFooter}>
      <ArkmeRelatedQuickNoteDetail
        state={relatedDetailState}
        onRetry={loadRelatedDetail}
        {...(normalizedSourceRef === '' ? {} : { sourceRef: normalizedSourceRef })}
        {...(shareWebsite === undefined ? {} : { shareWebsite })}
        {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
      />
    </ArkmeDetailShell>
  }
  return <ArkmeDetailShell title={historyOpen ? tr("编辑记录") : tr("快记详情")} label={historyOpen ? tr("编辑记录") : tr("快记详情")}
    onClose={closeDrawer} bodyRef={bodyRef} footer={extensionFooter} footerHidden={historyOpen}
    headerActions={!historyOpen && publicationTarget ? <WorldPublicationActions target={publicationTarget}/> : undefined}
    headerContent={historyOpen ? undefined : <ArkmeMessageDetailAuthor at={item.sendAtMillis}
      timeSuffix={publicationTarget ? <WorldPublicationBadge target={publicationTarget}/> : undefined} bot={item.senderKind === 'bot'}
      name={item.senderKind === 'bot' ? <ArkmeBotSenderName name={authorName} detail /> : authorName}
      avatar={<TeamRepresentationAvatar value={item.representation}><ArkmeUserAvatar senderKind={item.senderKind} {...(authorAvatarRef === undefined ? {} : { avatarRef: authorAvatarRef })}
        {...(roleAvatarFallback === undefined ? {} : { fallback: roleAvatarFallback })}
        size={40} label={tr("作者头像")} /></TeamRepresentationAvatar>} /> }
    {...(historyOpen ? { onBack: () => { setEditHistoryTarget(undefined) }, backLabel: '返回快记详情' }
      : onBackToExtension === undefined ? {} : { onBack: onBackToExtension, backLabel: tr('返回延展快记') })}>
    {historyOpen ? <ArkmeRecordEditHistory key={historyTarget} sourceRef={normalizedSourceRef} messageActionRef={messageActionRef}
      author={{ ...item, senderName: authorName, ...(authorAvatarRef === undefined ? {} : { avatarRef: authorAvatarRef }) }} /> : <>
    {detailLoading && <div role="status" style={styles.notice}>{tr('正在加载快记详情…')}</div>}
    {detailError && <div role="alert" style={styles.notice}>
      {tr(detailError)}{onRetryDetail && <button type="button" style={styles.toggle} onClick={onRetryDetail}>{tr('重试')}</button>}
    </div>}
    {quickNoteDetailsSupported && extensionParent !== undefined && <DetailExtensionParent parent={extensionParent} onOpen={onOpenExtensionParent} />}
    {canToggle && <button data-arkme-feedback="neutral" type="button" style={styles.toggle} onClick={onToggleOriginal}>{showOriginal ? '显示润色' : '显示原文'}</button>}
    <div data-arkme-timeline-detail-rich-content data-arkme-detail-scroll-anchor="original-message">
      <ArkmeMessageContent
        presentation="detail"
        item={{ ...item, textContent }}
        highlightMentions
        {...(sourceRef === undefined ? {} : { sourceRef })}
        {...(sourceIdentityKey === undefined ? {} : { sourceIdentityKey })}
        {...(shareWebsite === undefined ? {} : { shareWebsite })}
        {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
        onMentionClick={openMentionMemberProfile}
        isMentionClickable={mentionOpensMemberProfile}
      />
    </div>
    {showTopicBadge && <button data-arkme-feedback="neutral" data-arkme-detail-self-topic type="button"
      style={{ ...arkmeDetailSourceBadgeStyle, cursor: canOpenTopic ? 'pointer' : 'default' }}
      aria-label={tr("来源：{v0}", { v0: topicTitle })} disabled={!canOpenTopic}
      onClick={event => { event.stopPropagation(); if (selfTopicSource?.kind === 'topic') onOpenSelfTopic?.(selfTopicSource) }}>
      <ArkmeTopicSourceIcon />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topicTitle}</span>
      {canOpenTopic && <CaretRight size={12} aria-hidden style={{ flex: 'none' }} />}
    </button>}
    {sourceBadge}
    {personalSource && item.isMe && normalizedSourceRef && messageActionRef && <NoteWorldReactionArchive sourceRef={normalizedSourceRef} messageActionRef={messageActionRef} />}
    <style>{`.arkme-edit-history-entry { background: transparent; } .arkme-edit-history-entry:hover { background: ${arkmeTheme.hover}; }`}</style>
    {item.hasManualEdit === true && normalizedSourceRef !== '' && messageActionRef !== '' && <button data-arkme-feedback="neutral"
      type="button" aria-label={tr("已编辑")} className="arkme-edit-history-entry" style={{ display: 'flex', alignItems: 'center', gap: 2, height: 32, marginTop: 5, padding: 0, border: 0, borderRadius: 4, color: arkmeTheme.tertiary, font: 'inherit', fontSize: 12, cursor: 'pointer' }}
      onClick={() => {
        if (bodyRef.current !== null) scrollTopByViewRef.current['source-detail'] = bodyRef.current.scrollTop
        setEditHistoryTarget(historyTarget)
      }}>{tr("已编辑")}<CaretRight size={12} style={{ flex: 'none' }} aria-hidden /></button>}
    {quickNoteDetailsSupported && <ArkmeRelatedQuickNotesCard
      state={relatedState}
      onOpen={() => { navigateRelated('related-list') }}
      onRetry={loadRelated}
    />}
    {quickNoteDetailsSupported && <DetailExtensionContext
      rootItem={item}
      state={extensionState}
      optimistic={[...optimisticExtensions, ...extensionSendTasks.map(task => task.result?.extension ?? task.extension)]}
      sendTasks={extensionSendTasks}
      personalSource={personalSource}
      sourceKind={sourceKind}
      conversationMembers={conversationMembers}
      {...(currentSelfProfile === undefined ? {} : { currentSelfProfile })}
      {...(selectedExtensionRecordUid === undefined ? {} : { selectedRecordUid: selectedExtensionRecordUid })}
      {...(sourceRef === undefined ? {} : { sourceRef })}
      {...(sourceIdentityKey === undefined ? {} : { sourceIdentityKey })}
      {...(shareWebsite === undefined ? {} : { shareWebsite })}
      {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
      onMentionClick={openMentionMemberProfile}
      isMentionClickable={mentionOpensMemberProfile}
      onRetry={() => loadExtensionContext(extensionState.kind === 'success' && !extensionState.retryFromStart && extensionState.context.nextCursor ? extensionState.context : undefined)}
      canReply={canExtend && !messageCreationBlocked}
      selectedThoughtId={replyTarget?.kind === 'thought' ? replyTarget.thought.id : undefined}
      onReplyThought={thought => selectReply({ kind: 'thought', thought })}
      onSelect={extension => selectReply({ kind: 'extension', item: detailExtensionTimelineItem(extension, detailExtensionAuthor(extension, personalSource, currentSelfProfile, sourceKind, conversationMembers)) })}
    />}
    {!quickNoteDetailsSupported && <RecordThoughtContent item={item}/>}
    {memberProfile !== undefined && <ArkmeMemberProfileCard
      copyLinkTarget={memberProfile.isSelf ? { kind: 'self' } : sourceRef ? { kind: 'member', sourceRef, memberRef: memberProfile.memberRef } : undefined}
      member={memberProfile}
      showTopicNickname={sourceKind === 'group_chat'}
      busy={false}
      onClose={() => { setMemberProfile(undefined) }}
      onSend={openPrivateFromProfile}
    />}
    </>}
  </ArkmeDetailShell>
}

function ForwardDetailRow({ name, time, avatarRef, avatarKind, senderUserId, onPrivateChatOpened, representation, segment = false, children }: {
  name: string; time: string; avatarRef?: string | undefined; avatarKind?: 'deepseek' | undefined
  senderUserId?: number | undefined
  onPrivateChatOpened?: ((source: ArkmeSourceItem) => void) | undefined
  representation?: Pick<import('../team-group-contract.js').TeamRepresentationSnapshot, 'name' | 'jotmoId'> | undefined
  segment?: boolean; children: ReactNode
}) {
  return <div style={styles.row} {...(segment ? { 'data-arkme-forward-segment': 'true' } : {})}>
    {avatarKind === 'deepseek'
      ? <span role="img" aria-label="DeepSeek Harness 头像" style={{ width: 30, height: 30, flex: 'none' }}><DeepSeekLogoMark style={{ width: 30, height: 30, color: arkmeTheme.accent, opacity: 1 }} /></span>
      : <ForwardSenderAvatar name={name} avatarRef={avatarRef} senderUserId={senderUserId}
        onPrivateChatOpened={onPrivateChatOpened} segment={segment} />}
    <div style={styles.content}>
      <div style={styles.meta}><span style={styles.name}>{name}</span>{representation && <TeamRepresentationBadge value={representation} />}<span style={styles.time}>{time}</span></div>
      {children}
    </div>
  </div>
}

/**
 * Which account, if any, a forwarded row may start a private chat with. A
 * transcript speaker label is never an account identity even when it reuses the
 * sender's name and photo, and a surface that cannot navigate gets no entry.
 */
export function arkmeForwardSenderChatPeerId(
  senderUserId: number | undefined,
  segment: boolean,
  canNavigate: boolean,
): number | undefined {
  if (segment || !canNavigate) return undefined
  return senderUserId
}

/**
 * Snapshot sender avatar with a hover entry to their private chat. Only a row the
 * Provider resolved to another real account is actionable: transcript speakers
 * carry no account identity, and the viewer's own id never reaches the client.
 */
function ForwardSenderAvatar({ name, avatarRef, senderUserId, onPrivateChatOpened, segment }: {
  name: string; avatarRef?: string | undefined; senderUserId?: number | undefined
  onPrivateChatOpened?: ((source: ArkmeSourceItem) => void) | undefined; segment: boolean
}) {
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const anchorRef = useRef<HTMLSpanElement>(null)
  const avatar = <ArkmeUserAvatar {...(avatarRef === undefined ? {} : { avatarRef })} size={30}
    label={segment ? '转写说话人头像' : '转发消息头像'} />
  const peerUserId = arkmeForwardSenderChatPeerId(senderUserId, segment, onPrivateChatOpened !== undefined)
  if (peerUserId === undefined || onPrivateChatOpened === undefined) return avatar
  const startPrivateChat = async () => {
    setOpening(true); setError('')
    try {
      const opened = await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', {
        peerUserId,
        displayName: name,
      })
      setOpen(false)
      onPrivateChatOpened(opened.source)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setOpening(false)
    }
  }
  return <ArkmeActionMenu label={tr("{v0} 的操作", { v0: name })} open={open} align="start" side="right"
    onClose={() => { if (!opening) setOpen(false) }}
    hoverAnchor={anchorRef.current ?? undefined}
    getAnchorRect={() => anchorRef.current?.getBoundingClientRect() ?? null}
    anchor={<span ref={anchorRef} data-arkme-forward-sender-hover
      // Hover is the entry point; keyboard focus reaches the same card.
      onPointerEnter={event => { if (event.pointerType !== 'touch') { setError(''); setOpen(true) } }}
      onFocus={() => { setError(''); setOpen(true) }}
    >{avatar}</span>}
    actions={[
      { id: 'private-chat', label: opening ? tr("正在打开…") : tr("发起私聊"), disabled: opening, icon: <ChatCircle size={16} />, onSelect: () => { void startPrivateChat() } },
      ...(error === '' ? [] : [{ id: 'error' as const, label: <span role="alert">{error}</span>, disabled: true, onSelect: () => {} }]),
    ]} />
}

export function ForwardRecordsDetail({ item, onClose, sourceBadge, onPrivateChatOpened }: {
  item: ArkmeTimelineItem; onClose: () => void; sourceBadge?: ReactNode
  /** Opens a resolved snapshot sender's private chat, shared by every entry path. */
  onPrivateChatOpened?: ((source: ArkmeSourceItem) => void) | undefined
}) {
  const forward = item.forwardRecords
  if (forward === undefined) return null
  const recording = forward.items.length === 1 ? forward.items[0] : undefined
  if (recording?.sourceType === 'long_recording_segments' && (recording.segments?.length ?? 0) > 0) {
    const segments = recording.segments!
    const startedAt = recording.sendAtMillis
    const selectedAt = startedAt > 0 ? startedAt + Math.min(...segments.map(segment => segment.startMillis)) : 0
    const selectedDate = selectedAt > 0 ? new Date(selectedAt) : undefined
    return <ArkmeDetailShell title={recording.title || forward.title || tr("录音转写")} label={tr("录音片段详情")}
      subtitle={selectedDate === undefined ? '' : `${selectedDate.toLocaleDateString(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' })} ${selectedDate.toLocaleTimeString(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })}`} onClose={onClose}>
      {sourceBadge}
      <div data-arkme-forward-recording-detail>
        {segments.map((segment, index) => {
          const hours = Math.floor(segment.startMillis / 3_600_000)
          const time = hours > 0 ? `${String(hours).padStart(2, '0')}:${offsetLabel(segment.startMillis % 3_600_000)}` : offsetLabel(segment.startMillis)
          return <div key={index} data-arkme-forward-recording-segment style={{ padding: '8px 0', borderTop: index === 0 ? undefined : `0.5px solid ${arkmeTheme.borderSoft}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '22px' }}>
              <span aria-hidden style={{ width: 12, height: 12, flex: 'none', borderRadius: '50%', background: recordingSpeakerColor(segment.speakerNumber ?? index) }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500, letterSpacing: '.02px' }}>{segment.speakerName}</span>
              <time style={{ marginLeft: 4, color: arkmeTheme.tertiary, fontSize: 12, letterSpacing: '.24px' }}>{time}</time>
            </div>
            <p style={{ margin: '6px 0 0 20px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, lineHeight: '22px', letterSpacing: '.28px' }}><ArkmeRichText text={segment.textContent} presentation="preview" /></p>
          </div>
        })}
      </div>
      <RecordThoughtContent item={item} />
      {(forward.truncated || recording.truncated) && <p style={styles.notice}>{tr("内容较多，当前展示部分转发记录")}</p>}
    </ArkmeDetailShell>
  }
  const dates = forward.items.map(value => epoch(value.sendAtMillis)).filter(value => value > 0)
  const firstDate = dateLabel(dates.length ? Math.min(...dates) : forward.createdAtMillis)
  const lastDate = dateLabel(dates.length ? Math.max(...dates) : forward.createdAtMillis)
  // A summary is content, not structured sender metadata (colons also occur in tokens and URLs).
  const rows: ArkmeForwardRecordPreviewItem[] = forward.items.length ? forward.items : forward.summaryLines.map(line => ({
    senderName: '转发摘要', sendAtMillis: 0, title: '', textContent: line,
  }))
  const renderRecord = (value: ArkmeForwardRecordPreviewItem, index: number) => {
    const segments = value.segments ?? []
    const isArticle = value.templateKind === 8 || value.displayKind === 1
    const joinedTranscript = segments.map(segment => segment.textContent).join('').replace(/\s/gu, '')
    const hasDistinctText = value.textContent.trim() !== '' && value.textContent.replace(/\s/gu, '') !== joinedTranscript
    const snapshot: ArkmeTimelineItem = {
      itemUid: `${item.itemUid}-forward-${String(index)}`, senderName: value.senderName, isMe: false, sendAtMillis: value.sendAtMillis,
      status: 1, title: value.title,
      ...(value.displayKind === undefined ? {} : { displayKind: value.displayKind }),
      textContent: value.textContent || ((value.contentBlocks?.length ?? 0) === 0 ? value.contentLabel ?? '' : ''),
      ...(value.textFormat === undefined ? {} : { textFormat: value.textFormat }),
      ...(value.contentBlocks === undefined ? {} : { contentBlocks: value.contentBlocks }),
      ...(value.mediaUnavailable === undefined ? {} : { mediaUnavailable: value.mediaUnavailable }),
    }
    const hasRecordBody = segments.length === 0 || hasDistinctText || (value.contentBlocks?.length ?? 0) > 0
    return <div key={index} style={styles.rows}>
      {hasRecordBody && <ForwardDetailRow name={value.senderName} avatarRef={value.avatarRef} avatarKind={value.avatarKind}
        senderUserId={value.senderUserId} onPrivateChatOpened={onPrivateChatOpened} representation={value.sourceTeam}
        time={`${firstDate !== lastDate ? `${dateLabel(value.sendAtMillis)} ` : ''}${timeLabel(value.sendAtMillis)}`}>
        {!isArticle && value.title.trim() !== '' && (snapshot.textContent !== '' || (value.contentBlocks?.length ?? 0) > 0) && <h3 style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.7, overflowWrap: 'anywhere' }}>
          <ArkmeRichText text={value.title} presentation="preview" />
        </h3>}
        {isArticle && segments.length === 0 ? <ArkmeForwardArticleContent item={snapshot} /> : segments.length === 0 ? <ArkmeMessageContent item={snapshot} presentation="detail" highlightMentions /> : <>
          {hasDistinctText && <div style={{ marginBottom: 18 }}><ArkmeMessageContent item={{ ...snapshot, contentBlocks: [], mediaUnavailable: false }} presentation="detail" highlightMentions /></div>}
          {(value.contentBlocks?.length ?? 0) > 0 && <ArkmeMessageContent item={{ ...snapshot, title: '', textContent: '', mediaUnavailable: false }} presentation="detail" highlightMentions />}
        </>}
      </ForwardDetailRow>}
      {/* Snapshot speaker labels are not account identities. Never reuse the recording author's photo for another speaker. */}
      {segments.map((segment, segmentIndex) => <ForwardDetailRow key={segmentIndex} segment name={segment.speakerName}
        time={`${offsetLabel(segment.startMillis)}–${offsetLabel(segment.endMillis)}`}>
        <ArkmeMessageContent presentation="detail" item={{ ...snapshot, itemUid: `${snapshot.itemUid}-${String(segmentIndex)}`,
          senderName: segment.speakerName, title: '', textContent: segment.textContent,
          contentBlocks: segment.contentBlocks ?? [], mediaUnavailable: segment.mediaUnavailable === true }} highlightMentions />
      </ForwardDetailRow>)}
      {segments.length > 0 && value.mediaUnavailable && <p style={styles.notice}>{tr("部分媒体暂时无法加载，请刷新对话后重试")}</p>}
      {value.truncated && <p style={styles.notice}>{tr("内容较多，当前展示部分转发内容")}</p>}
    </div>
  }
  const forwardedAt = [dateLabel(forward.createdAtMillis), timeLabel(forward.createdAtMillis)].filter(Boolean).join(' ')
  return <ArkmeDetailShell title={forward.title || '转发快记'} label={tr("转发快记详情")}
    subtitle={firstDate === lastDate ? firstDate : tr("{v0} 至 {v1}", { v0: firstDate, v1: lastDate })}
    footer={forwardedAt ? tr("转发于 {v0}", { v0: forwardedAt }) : '转发时间未知'} onClose={onClose}>
    {sourceBadge}
    <div style={styles.rows}>{rows.map(renderRecord)}</div>
    <RecordThoughtContent item={item} />
    {rows.length === 0 && <p style={styles.notice}>{tr("原快记暂不可查看")}</p>}
    {forward.truncated && <p style={styles.notice}>{tr("内容较多，当前展示部分转发记录")}</p>}
  </ArkmeDetailShell>
}
