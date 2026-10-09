import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { ArkmeRecordEditHistory } from './ArkmeRecordEditHistory.js'
import { ArkmeBotSenderName } from './ArkmeBotIdentity.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { arkmeDetailExtensionComposerStyles } from './detail-extension-composer-style.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from './ArkmeRichComposerInput.js'
import type { ArkmeMarkdownDraft } from './markdown-editor.js'
import type { ArkmeProviderCapabilities } from '../types.js'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { FileTextIcon } from '@phosphor-icons/react/dist/csr/FileText'
import type {
  ArkmeBotList,
  ArkmeBotMentionInput,
  ArkmeConversationMemberItem,
  ArkmeForwardRecordPreviewItem,
  ArkmeGroupBotCandidateList,
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
import { ArkmeAttachmentStrip, ArkmeFilePreparingIndicator } from './ArkmeAttachmentStrip.js'
import {
  arkmeComposerAtomicDeletion,
  insertArkmeComposerMentionToken,
  reconcileArkmeComposerEmojis,
  reconcileArkmeComposerMentions,
  releaseArkmeComposerAttachment,
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
  arkmeMentionCandidateKey,
  arkmePrivateMentionCandidates,
  type ArkmeMentionCandidate,
} from './mention-candidates.js'
import { ArkmeComposerSendButton } from './ArkmeComposerSendButton.js'
import { ArkmeMentionSuggestionRow, ArkmeMentionSuggestionThemeStyles } from './ArkmeMentionSuggestionRow.js'
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
  extensionContext: { marginTop: 28 },
  extensionContextTitle: { marginBottom: 18, color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px', fontWeight: 500 },
  extensionContextList: { display: 'flex', flexDirection: 'column', gap: 10 },
  extensionContextRow: { display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, padding: '6px 8px', boxSizing: 'border-box',
    borderRadius: 12, background: 'transparent', cursor: 'pointer', outline: 0 },
  extensionContextRowSelected: { background: arkmeTheme.subtle },
  extensionContextBody: { flex: 1, minWidth: 0 },
  extensionContextHead: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  extensionContextName: { flex: 1, minWidth: 0, color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px', fontWeight: 500, overflowWrap: 'anywhere' },
  extensionContextTime: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  extensionContextStatus: { display: 'flex', alignItems: 'center', gap: 8, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '20px' },
  extensionContextRetry: { padding: 0, border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit' },
  extensionContextAvatarImage: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  extensionContextAvatarFallback: { width: 36, height: 36, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, overflow: 'hidden', background: arkmeTheme.layer2, color: arkmeTheme.secondary, fontSize: 13, fontWeight: 600 },
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

function DetailMentionSuggestions({ candidates, activeIndex, onActiveIndexChange, onSelect }: {
  candidates: readonly ArkmeMentionCandidate[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onSelect: (candidate: ArkmeMentionCandidate) => void
}) {
  return <div style={styles.mentionSuggestions} role="listbox" aria-label={tr("选择要 @ 的对象")}>
    <ArkmeMentionSuggestionThemeStyles />
    {candidates.length === 0
      ? <div style={styles.mentionSuggestionsEmpty}>{tr("暂无可 @ 的对象")}</div>
      : candidates.map((candidate, index) => <ArkmeMentionSuggestionRow
        key={arkmeMentionCandidateKey(candidate)}
        candidate={candidate}
        active={index === activeIndex}
        styles={{
          row: styles.mentionSuggestionRow!,
          rowActive: styles.mentionSuggestionRowActive!,
          avatar: styles.mentionSuggestionAvatar!,
          botAvatar: styles.mentionSuggestionBotAvatar!,
          text: styles.mentionSuggestionText!,
          name: styles.mentionSuggestionName!,
          secondary: styles.mentionSuggestionSecondary!,
        }}
        onActive={() => { onActiveIndexChange(index) }}
        onSelect={() => { onSelect(candidate) }}
      />)}
  </div>
}

interface DetailSelfRoleSelection {
  accountKey: string
  userId: number
  selectedRole?: ArkmeSelfRole | undefined
  selfAvatarRef?: string | undefined
  onSelect(role?: ArkmeSelfRole): void
}

function DetailExtensionComposer({ sourceRef, sourceKind, conversationMembers, messageActionRef, parentRecordUid, targetKey, selfRoleSelection, onSent, onError, messageCreationBlocked, messageCreationRestriction }: {
  sourceRef: string
  sourceKind?: ArkmeSourceKind | undefined
  conversationMembers?: readonly ArkmeConversationMemberItem[] | undefined
  messageActionRef: string
  parentRecordUid?: string | undefined
  targetKey: string
  selfRoleSelection?: DetailSelfRoleSelection | undefined
  onSent: (result: ArkmeSourceMessageExtendResult) => void
  onError: (message: string) => void
  messageCreationBlocked: boolean
  messageCreationRestriction: string
}) {
  useArkmeLocale()
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<ArkmeComposerMention[]>([])
  const [emojis, setEmojis] = useState<ArkmeComposerEmoji[]>([])
  const [markdown, setMarkdown] = useState<ArkmeMarkdownDraft>()
  const [markdownEnabled, setMarkdownEnabled] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeProviderCapabilities>('provider.capabilities', {}, controller.signal).then(value => { if (!controller.signal.aborted) setMarkdownEnabled(value.features.markdownQuickNotes === true) }).catch(() => {})
    return () => controller.abort()
  }, [sourceRef])
  const [attachments, setAttachments] = useState<ArkmeComposerAttachment[]>([])
  const [preparing, setPreparing] = useState(false)
  const [sending, setSending] = useState(false)
  const [draftPreview, setDraftPreview] = useState<ArkmeComposerAttachment>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stageAbortRef = useRef<AbortController>()
  const sendAbortRef = useRef<AbortController>()
  const sendPromiseRef = useRef<Promise<unknown>>()
  const generationRef = useRef(0)
  const attachmentsRef = useRef<ArkmeComposerAttachment[]>([])
  const submissionRef = useRef<{ fingerprint: string; recordUid: string; relationUid: string }>()
  const inputRef = useRef<ArkmeRichComposerHandle>(null)
  const textRef = useRef(text)
  const mentionsRef = useRef<readonly ArkmeComposerMention[]>(mentions)
  const emojisRef = useRef<readonly ArkmeComposerEmoji[]>(emojis)
  const [mentionTrigger, setMentionTrigger] = useState<ReturnType<typeof arkmeComposerMentionTrigger>>()
  const [mentionCandidateIndex, setMentionCandidateIndex] = useState(0)
  const [groupMentionBots, setGroupMentionBots] = useState<ArkmeGroupBotCandidateList>()
  const [privateMentionBots, setPrivateMentionBots] = useState<ArkmeBotList>()
  const mentionsEnabled = detailExtensionMentionsEnabled(sourceKind)
  const activeConversationMembers = conversationMembers ?? EMPTY_DETAIL_CONVERSATION_MEMBERS
  attachmentsRef.current = attachments
  textRef.current = text
  mentionsRef.current = mentions
  emojisRef.current = emojis
  useEffect(() => {
    generationRef.current += 1
    stageAbortRef.current?.abort()
    attachmentsRef.current = []
    sendAbortRef.current = undefined
    sendPromiseRef.current = undefined
    submissionRef.current = undefined
    setText(''); setMentions([]); setEmojis([]); setMarkdown(undefined)
    setMentionTrigger(undefined)
    setMentionCandidateIndex(0)
    setAttachments([])
    setPreparing(false)
    setSending(false)
    setDraftPreview(undefined)
    return () => {
      generationRef.current += 1
      stageAbortRef.current?.abort()
      const pending = attachmentsRef.current
      const pendingSend = sendPromiseRef.current
      attachmentsRef.current = []
      sendAbortRef.current?.abort()
      sendAbortRef.current = undefined
      sendPromiseRef.current = undefined
      removeDetailExtensionAttachmentsAfter(pending, pendingSend)
    }
  }, [targetKey])
  useEffect(() => {
    setGroupMentionBots(undefined)
    setPrivateMentionBots(undefined)
    setMentionTrigger(undefined)
    setMentionCandidateIndex(0)
  }, [sourceKind, sourceRef])
  useEffect(() => {
    if (!mentionsEnabled || mentionTrigger === undefined) return
    if (sourceKind === 'group_chat' && groupMentionBots !== undefined) return
    if (sourceKind === 'private_chat' && privateMentionBots !== undefined) return
    const controller = new AbortController()
    if (sourceKind === 'group_chat') {
      void callArkme<ArkmeGroupBotCandidateList>('group.bots', { sourceRef }, controller.signal)
        .then(snapshot => {
          if (!controller.signal.aborted) setGroupMentionBots(snapshot)
        })
        .catch(caught => {
          if (!controller.signal.aborted) console.warn('dsh-arkme: detail mention bot refresh failed', caught)
        })
    } else if (sourceKind === 'private_chat') {
      void callArkme<ArkmeBotList>('bots.list', undefined, controller.signal)
        .then(snapshot => {
          if (!controller.signal.aborted) setPrivateMentionBots(snapshot)
        })
        .catch(() => undefined)
    }
    return () => { controller.abort() }
  }, [groupMentionBots, mentionTrigger?.startIndex, mentionsEnabled, privateMentionBots, sourceKind, sourceRef])
  const mentionCandidates = useMemo((): ArkmeMentionCandidate[] => {
    if (!mentionsEnabled || mentionTrigger === undefined) return []
    if (sourceKind === 'group_chat') {
      return arkmeGroupMentionCandidates(mentionTrigger.query, groupMentionBots?.items ?? [], activeConversationMembers)
    }
    if (sourceKind === 'private_chat') {
      return arkmePrivateMentionCandidates(mentionTrigger.query, privateMentionBots?.items ?? [])
    }
    return []
  }, [activeConversationMembers, groupMentionBots?.items, mentionTrigger, mentionsEnabled, privateMentionBots?.items, sourceKind])
  useEffect(() => { setMentionCandidateIndex(0) }, [mentionTrigger?.startIndex, mentionTrigger?.endIndex, mentionTrigger?.query])
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
  const updateText = (value: string) => {
    if (messageCreationBlocked || preparing || sending) return
    const previousText = textRef.current
    setText(value)
    setMentions(reconcileArkmeComposerMentions(previousText, value, mentionsRef.current))
    setEmojis(reconcileArkmeComposerEmojis(previousText, value, emojisRef.current))
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
    if (messageCreationBlocked || files === null || files.length === 0 || preparing || sending) return
    const controller = new AbortController()
    stageAbortRef.current?.abort()
    stageAbortRef.current = controller
    setPreparing(true)
    const next: ArkmeComposerAttachment[] = []
    let appended = false
    try {
      const sdk = createArkmeSdk()
      const policy = await sdk.fileCapabilities(controller.signal)
      const selected = Array.from(files)
      const failures: string[] = []
      for (const file of selected) {
        controller.signal.throwIfAborted()
        if (attachments.length + next.length >= policy.maxAttachments) {
          failures.push(tr("最多添加 {v0} 个附件：{v1}", { v0: String(policy.maxAttachments), v1: file.name }))
          continue
        }
        const limit = file.type.startsWith('image/') ? policy.maxImageBytes : policy.maxFileBytes
        if (file.size <= 0 || file.size > limit) {
          failures.push(tr("{v0} 为空或超过 {v1} MiB", { v0: file.name, v1: String(Math.floor(limit / 1024 / 1024)) }))
          continue
        }
        try {
          const localFile = await sdk.stageFile(file, { signal: controller.signal })
          const previewUrl = localFile.fileKind === 1 && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(file) : undefined
          next.push({ localFile, ...(previewUrl === undefined ? {} : { previewUrl }) })
        } catch (caught) {
          if (controller.signal.aborted) throw caught
          failures.push(caught instanceof Error ? `${file.name}：${caught.message}` : tr("{v0}：附件准备失败", { v0: file.name }))
        }
      }
      if (!controller.signal.aborted && next.length > 0) {
        const combined = [...attachmentsRef.current, ...next]
        attachmentsRef.current = combined
        appended = true
        setAttachments(combined)
      }
      if (failures.length > 0) onError(failures.join('；'))
    } catch (caught) {
      if (!controller.signal.aborted) onError(caught instanceof Error ? caught.message : '附件准备失败')
    } finally {
      if (stageAbortRef.current === controller) {
        stageAbortRef.current = undefined
        setPreparing(false)
      }
      if (fileInputRef.current !== null) fileInputRef.current.value = ''
      if (!appended && next.length > 0) {
        void removeDetailExtensionAttachments(next)
      }
    }
  }
  const send = async () => {
    const serializedDraft = serializeArkmeComposerDraft({
      text,
      mentions,
      emojis,
      attachments,
      ...(markdown === undefined ? {} : { markdown }),
    })
    const normalizedText = serializedDraft.textFormat === 'markdown' ? serializedDraft.text : serializedDraft.text.trim()
    const humanMentions = detailHumanMentionInputs(serializedDraft.mentions)
    const botMentions = detailBotMentionInputs(serializedDraft.mentions)
    const fileRefs = attachments.flatMap(attachment => attachment.localFile === undefined ? [] : [attachment.localFile.fileRef])
    if (messageCreationBlocked || sending || preparing || (normalizedText === '' && fileRefs.length === 0)) return
    const roleAtSendStart = selfRoleSelection?.selectedRole
    const fingerprint = JSON.stringify([parentRecordUid ?? '', normalizedText, fileRefs, serializedDraft.textFormat ?? 'plain', humanMentions, botMentions, roleAtSendStart?.roleId ?? 'me'])
    const recordUid = submissionRef.current?.fingerprint === fingerprint
      ? submissionRef.current.recordUid
      : crypto.randomUUID()
    const relationUid = submissionRef.current?.fingerprint === fingerprint
      ? submissionRef.current.relationUid
      : crypto.randomUUID()
    submissionRef.current = { fingerprint, recordUid, relationUid }
    const generation = generationRef.current
    const controller = new AbortController()
    sendAbortRef.current = controller
    setSending(true)
    const request = (async (): Promise<ArkmeSourceMessageExtendResult> => {
      let roleSnapshot: ArkmeSelfRoleSnapshot | undefined
      let providerWriteStarted = false
      try {
        if (roleAtSendStart !== undefined && selfRoleSelection !== undefined) {
          // Bind before the cloud write, so a bind failure never sends a message under the wrong identity.
          roleSnapshot = await callArkme<ArkmeSelfRoleSnapshot>('self-roles.bind', {
            expectedUserId: selfRoleSelection.userId,
            sourceRef,
            recordUid,
            roleId: roleAtSendStart.roleId,
          }, controller.signal)
          if (generationRef.current !== generation || controller.signal.aborted) throw new Error('延展已取消')
        }
        providerWriteStarted = true
        const sent = await callArkme<ArkmeSourceMessageExtendResult>('source.message-extension.extend', {
          sourceRef,
          messageActionRef,
          textContent: serializedDraft.text,
          ...(serializedDraft.textFormat === undefined ? {} : { textFormat: serializedDraft.textFormat }),
          ...(humanMentions.length === 0 ? {} : { humanMentions }),
          ...(botMentions.length === 0 ? {} : { botMentions }),
          recordUid,
          relationUid,
          ...(parentRecordUid === undefined ? {} : { parentRecordUid }),
          fileRefs,
        }, controller.signal)
        if (roleSnapshot !== undefined && selfRoleSelection !== undefined && sent.recordUid !== recordUid) {
          try {
            await callArkme('self-roles.rebind', {
              expectedUserId: selfRoleSelection.userId, recordUid, newRecordUid: sent.recordUid,
            }, controller.signal)
          } catch (caught) {
            onError(`延展已发送，但角色展示暂未保存：${caught instanceof Error ? caught.message : '请刷新后重试'}`)
          }
        }
        return roleSnapshot === undefined ? sent : { ...sent, extension: { ...sent.extension, selfRole: roleSnapshot } }
      } catch (caught) {
        if (roleSnapshot !== undefined && !providerWriteStarted && selfRoleSelection !== undefined) {
          await callArkme('self-roles.unbind', {
            expectedUserId: selfRoleSelection.userId, recordUid, roleId: roleAtSendStart!.roleId,
          }).catch(() => undefined)
        }
        throw caught
      }
    })()
    sendPromiseRef.current = request
    try {
      const result = await request as ArkmeSourceMessageExtendResult
      if (generationRef.current !== generation || controller.signal.aborted) return
      submissionRef.current = undefined
      attachmentsRef.current = []
      for (const attachment of attachments) releaseArkmeComposerAttachment(attachment)
      setText(''); setMentions([]); setEmojis([]); setMarkdown(undefined)
      setMentionTrigger(undefined)
      setAttachments([])
      setDraftPreview(undefined)
      onSent(result)
      const sdk = createArkmeSdk()
      void Promise.all(fileRefs.map(async fileRef => { await sdk.removeLocalFile(fileRef) })).catch(() => {})
    } catch (caught) {
      if (generationRef.current === generation && !controller.signal.aborted) {
        onError(caught instanceof Error ? caught.message : '延展发送失败，请重试')
      }
    } finally {
      if (sendPromiseRef.current === request) sendPromiseRef.current = undefined
      if (sendAbortRef.current === controller) sendAbortRef.current = undefined
      if (generationRef.current === generation) setSending(false)
    }
  }
  const disabled = messageCreationBlocked || preparing || sending
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
      {mentionTrigger !== undefined && <DetailMentionSuggestions
        candidates={mentionCandidates}
        activeIndex={mentionCandidateIndex}
        onActiveIndexChange={setMentionCandidateIndex}
        onSelect={insertMentionCandidate}
      />}
      <div className="arkme-detail-extension-input-shell" style={styles.extensionInputWrap}>
        <button data-arkme-feedback="neutral" type="button" style={{ ...styles.extensionTool, opacity: disabled ? .4 : 1 }} aria-label={tr("添加延展附件")} disabled={disabled}
          onClick={() => { fileInputRef.current?.click() }}>{preparing ? <ArkmeFilePreparingIndicator /> : <FileTextIcon size={18} />}</button>
        <ArkmeRichComposerInput ref={inputRef} style={styles.extensionInput!} ariaLabel={tr("延展此快记")} placeholder={tr("延展此快记...")} value={text} disabled={disabled}
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
            if (mentionTrigger !== undefined) {
              if (event.key === 'Escape') {
                event.preventDefault()
                setMentionTrigger(undefined)
                return
              }
              if (event.key === 'ArrowDown' && mentionCandidates.length > 0) {
                event.preventDefault()
                setMentionCandidateIndex(index => (index + 1) % mentionCandidates.length)
                return
              }
              if (event.key === 'ArrowUp' && mentionCandidates.length > 0) {
                event.preventDefault()
                setMentionCandidateIndex(index => (index + mentionCandidates.length - 1) % mentionCandidates.length)
                return
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && mentionCandidates.length > 0) {
                event.preventDefault()
                const selectedCandidate = mentionCandidates[Math.min(mentionCandidateIndex, mentionCandidates.length - 1)]
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
          disabled={disabled || !canSend}
          shortcutHint={tr("Enter发送 / Shift+Enter换行")}
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
  | { kind: 'success'; context: ArkmeSourceMessageExtensionContext }
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
    itemUid: item.recordUid,
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
  state, optimistic, selectedRecordUid, sourceRef, sourceIdentityKey, shareWebsite, onMessageCopyLinkOpen, onMentionClick, isMentionClickable, onRetry, onSelect,
  personalSource, currentSelfProfile, sourceKind, conversationMembers,
}: {
  state: ArkmeDetailExtensionLoadState
  optimistic: readonly ArkmeMessageCopyLinkExtensionItem[]
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
}) {
  const context = state.kind === 'success' ? state.context : undefined
  const byUid = new Map<string, ArkmeMessageCopyLinkExtensionItem>()
  for (const item of optimistic) byUid.set(item.recordUid, item)
  for (const item of context?.extensions ?? []) {
    const pending = byUid.get(item.recordUid)
    byUid.set(item.recordUid, item.selfRole === undefined && pending?.selfRole !== undefined
      ? { ...item, selfRole: pending.selfRole } : item)
  }
  const extensions = [...byUid.values()]
  const extensionCount = Math.max(context?.extensionCount ?? 0, extensions.length)
  if ((state.kind === 'idle' || state.kind === 'loading') && extensions.length === 0) return null
  if (state.kind === 'error' && extensions.length === 0) {
    return <div style={styles.extensionContext}><div role="alert" style={styles.extensionContextStatus}>
      <span>{state.message}</span><button data-arkme-feedback="neutral" type="button" style={styles.extensionContextRetry} onClick={onRetry}>{tr("重试")}</button>
    </div></div>
  }
  if (extensionCount === 0) return null
  return <section style={styles.extensionContext} aria-label={tr("快记延展列表")}>
    <div style={styles.extensionContextTitle} data-arkme-note-extension-count="true">{tr("共")}{extensionCount}{tr("条延展")}</div>
    <div style={styles.extensionContextList}>{orderedDetailExtensions(extensions, context?.parentRecordUid ?? '').map(({ item: extension, nested }) => {
      const author = detailExtensionAuthor(extension, personalSource, currentSelfProfile, sourceKind, conversationMembers)
      const timelineItem = detailExtensionTimelineItem(extension, author)
      const missingMedia = extension.mediaUnavailable === true && extension.mediaItems.length > 0
        && (extension.title.trim() !== '' || extension.textContent.trim() !== '' || (extension.contentBlocks?.length ?? 0) > 0)
      const selected = extension.recordUid === selectedRecordUid
      return <div key={extension.recordUid} style={{
        ...styles.extensionContextRow,
        ...(selected ? styles.extensionContextRowSelected : {}),
        ...(nested ? { marginLeft: 30 } : {}),
      }}
        role="button" tabIndex={0} aria-pressed={selected}
        data-arkme-note-extension-item={extension.recordUid}
        onClick={() => { onSelect(extension) }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(extension) } }}>
        <DetailExtensionAvatar author={author} size={nested ? 28 : 32} />
        <div style={styles.extensionContextBody}>
          <div style={styles.extensionContextHead}>
            <span style={styles.extensionContextName}>{author.name}</span>
            <span style={styles.extensionContextTime}>{[dateLabel(extension.sendAtMillis), timeLabel(extension.sendAtMillis)].filter(Boolean).join(' ')}</span>
          </div>
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
          {missingMedia && <span data-arkme-missing-extension-media style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 5, color: arkmeTheme.tertiary, fontSize: 12 }}>
            <FileTextIcon size={13} aria-hidden />{tr('附件暂不可用')}
          </span>}
        </div>
      </div>
    })}</div>
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
  const [optimisticExtensions, setOptimisticExtensions] = useState<ArkmeMessageCopyLinkExtensionItem[]>([])
  const [selectedExtensionRecordUid, setSelectedExtensionRecordUid] = useState<string>()
  const [memberProfile, setMemberProfile] = useState<ArkmeConversationMemberItem>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopByViewRef = useRef<Record<ArkmeRelatedDrawerView, number>>({
    'source-detail': 0,
    'related-list': 0,
    'related-detail': 0,
  })
  const messageActionRef = item.messageActionRef?.trim() ?? ''
  const normalizedSourceRef = sourceRef?.trim() ?? ''
  const historyTarget = `${normalizedSourceRef}:${item.itemUid}`
  const historyOpen = editHistoryTarget === historyTarget && messageActionRef !== ''
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
    const readRelated = () => callArkme<ArkmeRelatedQuickNoteList>('source.related-quick-notes.from-message', {
      sourceRef: normalizedSourceRef,
      messageActionRef,
    }, controller.signal)
    void readRelated().then(async first => {
      if (first.items.length > 0 || controller.signal.aborted) return first
      // A successful empty recall can be transient. Recheck once without
      // manufacturing related notes or keeping stale results indefinitely.
      try { return await readRelated() } catch { return first }
    }).then(list => {
      if (controller.signal.aborted || listAbortRef.current !== controller) return
      setRelatedState(list.items.length === 0 ? { kind: 'empty' } : { kind: 'success', list })
    }).catch(error => {
      if (controller.signal.aborted || listAbortRef.current !== controller) return
      setRelatedState({ kind: 'error', message: relatedQuickNoteErrorMessage(error, '相关快记加载失败') })
    })
  }, [messageActionRef, normalizedSourceRef, quickNoteDetailsSupported])
  const loadExtensionContext = useCallback(() => {
    extensionAbortRef.current?.abort()
    if (!quickNoteDetailsSupported || normalizedSourceRef === '' || messageActionRef === '') {
      setExtensionState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    extensionAbortRef.current = controller
    setExtensionState(current => current.kind === 'success' ? current : { kind: 'loading' })
    void callArkme<ArkmeSourceMessageExtensionContext>('source.message-extension.context', {
      sourceRef: normalizedSourceRef,
      messageActionRef,
    }, controller.signal).then(context => {
      if (controller.signal.aborted || extensionAbortRef.current !== controller) return
      setExtensionState({ kind: 'success', context })
    }).catch(error => {
      if (controller.signal.aborted || extensionAbortRef.current !== controller) return
      setExtensionState({ kind: 'error', message: relatedQuickNoteErrorMessage(error, '延展加载失败') })
    })
  }, [messageActionRef, normalizedSourceRef, quickNoteDetailsSupported])
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
    setSelectedExtensionRecordUid(undefined)
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
    sourceRef={normalizedSourceRef}
    sourceKind={sourceKind}
    {...(personalSource && selfRoleSelection !== undefined ? { selfRoleSelection } : {})}
    conversationMembers={conversationMembers}
    messageActionRef={messageActionRef}
    messageCreationBlocked={messageCreationBlocked}
    messageCreationRestriction={messageCreationRestriction}
    {...(selectedExtensionRecordUid === undefined ? {} : { parentRecordUid: selectedExtensionRecordUid })}
    targetKey={`${normalizedSourceRef}:${item.itemUid}:${selectedExtensionRecordUid ?? item.itemUid}`}
    onError={message => { onToast?.(message) }}
    onSent={result => {
      setOptimisticExtensions(current => [result.extension, ...current.filter(item => item.recordUid !== result.recordUid)])
      onExtensionSent?.(result)
      loadExtensionContext()
    }}
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
    headerContent={historyOpen ? undefined : <div data-arkme-detail-author style={{ ...styles.row, alignItems: 'center', ...(item.senderKind === 'bot' ? { gap: 10 } : {}) }}>
      <ArkmeUserAvatar senderKind={item.senderKind} {...(authorAvatarRef === undefined ? {} : { avatarRef: authorAvatarRef })}
        {...(roleAvatarFallback === undefined ? {} : { fallback: roleAvatarFallback })}
        size={40} label={tr("作者头像")} />
      <div style={styles.content}><div style={styles.name}>{item.senderKind === 'bot' ? <ArkmeBotSenderName name={authorName} detail /> : authorName}</div>
        <div style={{ ...styles.time, marginTop: item.senderKind === 'bot' ? 2 : 4, ...(item.senderKind === 'bot' ? { fontSize: 12 } : {}) }}>{[dateLabel(item.sendAtMillis), timeLabel(item.sendAtMillis)].filter(Boolean).join(' ')}</div>
      </div>
    </div>}
    {...(historyOpen ? { onBack: () => { setEditHistoryTarget(undefined) }, backLabel: '返回快记详情' }
      : onBackToExtension === undefined ? {} : { onBack: onBackToExtension, backLabel: tr('返回延展快记') })}>
    {historyOpen ? <ArkmeRecordEditHistory key={historyTarget} sourceRef={normalizedSourceRef} messageActionRef={messageActionRef} author={item} /> : <>
    {quickNoteDetailsSupported && extensionParent !== undefined && <DetailExtensionParent parent={extensionParent} onOpen={onOpenExtensionParent} />}
    {canToggle && <button data-arkme-feedback="neutral" type="button" style={styles.toggle} onClick={onToggleOriginal}>{showOriginal ? '显示润色' : '显示原文'}</button>}
    <div data-arkme-timeline-detail-rich-content>
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
      state={extensionState}
      optimistic={optimisticExtensions}
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
      onRetry={loadExtensionContext}
      onSelect={extension => { setSelectedExtensionRecordUid(extension.recordUid) }}
    />}
    {memberProfile !== undefined && <ArkmeMemberProfileCard
      member={memberProfile}
      showTopicNickname={sourceKind === 'group_chat'}
      busy={false}
      onClose={() => { setMemberProfile(undefined) }}
      onSend={openPrivateFromProfile}
    />}
    </>}
  </ArkmeDetailShell>
}

function ForwardDetailRow({ name, time, avatarRef, avatarKind, senderUserId, onPrivateChatOpened, segment = false, children }: {
  name: string; time: string; avatarRef?: string | undefined; avatarKind?: 'deepseek' | undefined
  senderUserId?: number | undefined
  onPrivateChatOpened?: ((source: ArkmeSourceItem) => void) | undefined
  segment?: boolean; children: ReactNode
}) {
  return <div style={styles.row} {...(segment ? { 'data-arkme-forward-segment': 'true' } : {})}>
    {avatarKind === 'deepseek'
      ? <span role="img" aria-label="DeepSeek Harness 头像" style={{ width: 30, height: 30, flex: 'none' }}><DeepSeekLogoMark style={{ width: 30, height: 30, color: arkmeTheme.accent, opacity: 1 }} /></span>
      : <ForwardSenderAvatar name={name} avatarRef={avatarRef} senderUserId={senderUserId}
        onPrivateChatOpened={onPrivateChatOpened} segment={segment} />}
    <div style={styles.content}>
      <div style={styles.meta}><span style={styles.name}>{name}</span><span style={styles.time}>{time}</span></div>
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
        senderUserId={value.senderUserId} onPrivateChatOpened={onPrivateChatOpened}
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
    {rows.length === 0 && <p style={styles.notice}>{tr("原快记暂不可查看")}</p>}
    {forward.truncated && <p style={styles.notice}>{tr("内容较多，当前展示部分转发记录")}</p>}
  </ArkmeDetailShell>
}
