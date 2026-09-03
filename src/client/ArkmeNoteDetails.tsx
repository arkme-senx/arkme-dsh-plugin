import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { XIcon as X } from '@phosphor-icons/react/dist/csr/X'
import { FileTextIcon } from '@phosphor-icons/react/dist/csr/FileText'
import type {
  ArkmeForwardRecordPreviewItem,
  ArkmeMessageCopyLinkExtensionItem,
  ArkmeRelatedQuickNoteDetail as ArkmeRelatedQuickNoteDetailDto,
  ArkmeRelatedQuickNoteItem,
  ArkmeRelatedQuickNoteList,
  ArkmeSourceMessageExtendResult,
  ArkmeSourceMessageExtensionContext,
  ArkmeTimelineItem,
} from '../types.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeMediaPreview, ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMentionText } from './ArkmeRichText.js'
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
import { arkmeTheme } from './arkme-theme.js'
import { ARKME_CONVERSATION_HEADER_HEIGHT } from './interwoven-moments.js'
import { createArkmeSdk } from '../sdk/index.js'
import { ArkmeAttachmentStrip, ArkmeFilePreparingIndicator } from './ArkmeAttachmentStrip.js'
import { releaseArkmeComposerAttachment, type ArkmeComposerAttachment } from './composer-draft-store.js'
import { localFileBlock } from './file-send-tasks.js'

const styles: Record<string, CSSProperties> = {
  drawer: { position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, zIndex: 10,
    width: 'min(372px, 100%)', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    background: arkmeTheme.base, color: arkmeTheme.text, borderLeft: `1px solid ${arkmeTheme.borderSoft}`,
    boxShadow: '-12px 0 28px rgba(29,32,40,.055)' },
  header: { flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '22px 20px 0 22px' },
  heading: { flex: 1, minWidth: 0 },
  title: { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, overflowWrap: 'anywhere' },
  subtitle: { marginTop: 8, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  close: { width: 30, height: 30, marginTop: -3, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer' },
  back: { width: 30, height: 30, marginTop: -3, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '24px 22px' },
  rows: { display: 'flex', flexDirection: 'column', gap: 23 },
  row: { display: 'flex', gap: 9, alignItems: 'flex-start' },
  content: { flex: 1, minWidth: 0 },
  meta: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 },
  name: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: arkmeTheme.secondary, fontSize: 12, fontWeight: 600 },
  time: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  footer: { flex: 'none', textAlign: 'center', padding: '12px 22px 20px', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  extensionFooter: { flex: 'none', padding: 0, color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  extensionComposer: { display: 'flex', flexDirection: 'column' },
  extensionAttachmentPreview: { padding: '8px 16px' },
  extensionInputBar: { padding: '12px 16px', borderTop: '0.5px solid #e6e6e6' },
  extensionInputWrap: { minHeight: 44, maxHeight: 100, display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 12px', boxSizing: 'border-box', border: 0, borderRadius: 12, background: '#f6f6f6' },
  extensionInput: { flex: 1, minWidth: 0, minHeight: 28, maxHeight: 84, boxSizing: 'border-box', fieldSizing: 'content', overflowY: 'auto', resize: 'none', border: 0, outline: 0, padding: '4px 0 3px', background: 'transparent', color: arkmeTheme.text, font: 'inherit', fontSize: 14, lineHeight: '20px' },
  extensionTool: { width: 18, height: 28, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer' },
  extensionSend: { width: 28, height: 28, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 999, background: arkmeTheme.text, color: arkmeTheme.base, cursor: 'pointer', fontSize: 16 },
  extensionParent: { margin: '12px 0 16px', paddingLeft: 10, borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: arkmeTheme.border,
    color: arkmeTheme.tertiary, fontSize: 13, lineHeight: '20px', overflow: 'hidden' },
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

function epoch(value: number): number {
  return Number.isFinite(value) && value > 0 && value < 8.64e15 ? value < 1e12 ? value * 1000 : value : 0
}

function dateLabel(value: number): string {
  const time = epoch(value)
  return time === 0 ? '' : new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function timeLabel(value: number): string {
  const time = epoch(value)
  return time === 0 ? '' : new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function offsetLabel(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** Non-modal overlay: the conversation retains its width and scroll position. */
function NoteDetailShell({ title, label, subtitle, footer, onClose, onBack, backLabel, bodyRef, children }: {
  title: string; label: string; subtitle?: string; footer?: ReactNode; onClose: () => void; children: ReactNode
  onBack?: () => void; backLabel?: string; bodyRef?: Ref<HTMLDivElement>
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = useId()
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    ;(onBack === undefined ? closeRef.current : backRef.current)?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      // A portal preview owns Escape until it is closed; do not close both layers.
      if (event.key !== 'Escape' || event.defaultPrevented
        || document.querySelector('[data-arkme-image-preview-viewport], [aria-modal="true"]') !== null) return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    const panel = panelRef.current
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const active = document.activeElement
      if (trigger?.isConnected && (active === document.body || active === null || panel?.contains(active))) trigger.focus({ preventScroll: true })
    }
  }, [])
  return <aside ref={panelRef} role="dialog" aria-label={label} aria-labelledby={titleId} style={styles.drawer} data-arkme-note-detail="true">
    <header style={styles.header}>
      {onBack !== undefined && <button ref={backRef} type="button" style={styles.back}
        aria-label={backLabel ?? '返回'} onClick={onBack}><ArrowLeft size={18} /></button>}
      <div style={styles.heading}><h3 id={titleId} style={styles.title}>{title}</h3>
        {subtitle && <div style={styles.subtitle}>{subtitle}</div>}
      </div>
      <button ref={closeRef} type="button" style={styles.close} aria-label="关闭详情" onClick={onClose}><X size={18} /></button>
    </header>
    <div ref={bodyRef} style={styles.body}>{children}</div>
    {footer !== undefined && footer !== null && <footer style={typeof footer === 'string' ? styles.footer : styles.extensionFooter}>{footer}</footer>}
  </aside>
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

function DetailExtensionComposer({ sourceRef, messageActionRef, parentRecordUid, targetKey, onSent, onError }: {
  sourceRef: string
  messageActionRef: string
  parentRecordUid?: string | undefined
  targetKey: string
  onSent: (result: ArkmeSourceMessageExtendResult) => void
  onError: (message: string) => void
}) {
  const [text, setText] = useState('')
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
  attachmentsRef.current = attachments
  useEffect(() => {
    generationRef.current += 1
    stageAbortRef.current?.abort()
    attachmentsRef.current = []
    sendAbortRef.current = undefined
    sendPromiseRef.current = undefined
    submissionRef.current = undefined
    setText('')
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
  const selectFiles = async (files: FileList | readonly File[] | null) => {
    if (files === null || files.length === 0 || preparing || sending) return
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
          failures.push(`最多添加 ${String(policy.maxAttachments)} 个附件：${file.name}`)
          continue
        }
        const limit = file.type.startsWith('image/') ? policy.maxImageBytes : policy.maxFileBytes
        if (file.size <= 0 || file.size > limit) {
          failures.push(`${file.name} 为空或超过 ${String(Math.floor(limit / 1024 / 1024))} MiB`)
          continue
        }
        try {
          const localFile = await sdk.stageFile(file, { signal: controller.signal })
          const previewUrl = localFile.fileKind === 1 && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(file) : undefined
          next.push({ localFile, ...(previewUrl === undefined ? {} : { previewUrl }) })
        } catch (caught) {
          if (controller.signal.aborted) throw caught
          failures.push(caught instanceof Error ? `${file.name}：${caught.message}` : `${file.name}：附件准备失败`)
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
    const normalizedText = text.trim()
    const fileRefs = attachments.flatMap(attachment => attachment.localFile === undefined ? [] : [attachment.localFile.fileRef])
    if (sending || preparing || (normalizedText === '' && fileRefs.length === 0)) return
    const fingerprint = JSON.stringify([parentRecordUid ?? '', normalizedText, fileRefs])
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
    const request = callArkme('source.message-extension.extend', {
      sourceRef,
      messageActionRef,
      textContent: normalizedText,
      recordUid,
      relationUid,
      ...(parentRecordUid === undefined ? {} : { parentRecordUid }),
      fileRefs,
    }, controller.signal)
    sendPromiseRef.current = request
    try {
      const result = await request as ArkmeSourceMessageExtendResult
      if (generationRef.current !== generation || controller.signal.aborted) return
      submissionRef.current = undefined
      attachmentsRef.current = []
      for (const attachment of attachments) releaseArkmeComposerAttachment(attachment)
      setText('')
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
  const disabled = preparing || sending
  return <div style={styles.extensionComposer}
    onDragOver={event => { if (!disabled && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDrop={event => { if (!disabled && event.dataTransfer.files.length > 0) { event.preventDefault(); void selectFiles(event.dataTransfer.files) } }}>
    <input ref={fileInputRef} type="file" multiple hidden data-arkme-detail-extension-file-input="true"
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
      <div className="arkme-detail-extension-input-shell" style={styles.extensionInputWrap}>
        <button type="button" style={{ ...styles.extensionTool, opacity: disabled ? .4 : 1 }} aria-label="添加延展附件" disabled={disabled}
          onClick={() => { fileInputRef.current?.click() }}>{preparing ? <ArkmeFilePreparingIndicator /> : <FileTextIcon size={18} />}</button>
        <textarea rows={1} style={styles.extensionInput} aria-label="延展此快记" placeholder="延展此快记..." value={text} disabled={disabled}
          onChange={event => { setText(event.target.value) }}
          onPaste={event => { const files = clipboardFiles(event.clipboardData); if (files.length > 0) { event.preventDefault(); void selectFiles(files) } }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
        <button type="button" style={{ ...styles.extensionSend, opacity: normalizedSendOpacity(text, attachments.length, disabled) }}
          aria-label="发送延展" disabled={disabled || (text.trim() === '' && attachments.length === 0)} onClick={() => { void send() }}>↑</button>
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

function normalizedSendOpacity(text: string, attachmentCount: number, disabled: boolean): number {
  return disabled || text.trim() === '' && attachmentCount === 0 ? .35 : 1
}

export function arkmeTimelineDetailSenderText(item: ArkmeTimelineItem): string {
  return item.agentSource === undefined ? item.senderName : `${item.senderName} · ${item.agentSource.label}`
}

type ArkmeDetailExtensionLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; context: ArkmeSourceMessageExtensionContext }
  | { kind: 'error'; message: string }

function detailExtensionSenderName(item: ArkmeMessageCopyLinkExtensionItem): string {
  return item.senderDisplayName.trim() || (item.sourceKind === 'agent_message' ? 'Agent' : '未知用户')
}

function detailExtensionTimelineItem(item: ArkmeMessageCopyLinkExtensionItem): ArkmeTimelineItem {
  const avatar = item.senderAvatarUrl?.trim() ?? ''
  return {
    itemUid: item.recordUid,
    senderName: detailExtensionSenderName(item),
    isMe: false,
    sendAtMillis: item.sendAtMillis,
    title: item.title,
    textContent: item.textContent,
    status: 1,
    templateKind: item.templateKind,
    displayKind: item.displayKind,
    ...(item.contentBlocks === undefined ? {} : { contentBlocks: item.contentBlocks }),
    ...(item.mediaUnavailable === true ? { mediaUnavailable: true } : {}),
    ...(avatar !== '' && !/^(https?:|data:|blob:)/iu.test(avatar) ? { avatarRef: avatar } : {}),
  }
}

function DetailExtensionAvatar({ item, size = 32 }: { item: ArkmeMessageCopyLinkExtensionItem; size?: number }) {
  const name = detailExtensionSenderName(item)
  const avatar = item.senderAvatarUrl?.trim() ?? ''
  if (/^(https?:|data:|blob:)/iu.test(avatar)) {
    return <span style={{ ...styles.extensionContextAvatarFallback, width: size, height: size }} aria-hidden>
      <img src={avatar} alt="" draggable={false} style={styles.extensionContextAvatarImage} />
    </span>
  }
  if (avatar !== '') return <ArkmeUserAvatar avatarRef={avatar} size={size} label="延展作者头像" />
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

function DetailExtensionParent({ parent }: { parent: NonNullable<ArkmeTimelineItem['extensionParent']> }) {
  const text = parent.textContent.trim() || parent.title.trim()
  const attachmentText = (parent.contentBlocks ?? []).map(block => block.fileName.trim()).filter(Boolean).join('、')
  const preview = text || attachmentText
  if (preview === '') return null
  return <div style={styles.extensionParent} data-arkme-detail-extension-parent={parent.itemUid}>
    <span style={styles.extensionParentText}><ArkmeMentionText text={preview} /></span>
  </div>
}

function DetailExtensionContext({ state, optimistic, selectedRecordUid, sourceRef, shareWebsite, onMessageCopyLinkOpen, onRetry, onSelect }: {
  state: ArkmeDetailExtensionLoadState
  optimistic: readonly ArkmeMessageCopyLinkExtensionItem[]
  selectedRecordUid?: string | undefined
  sourceRef?: string | undefined
  shareWebsite?: string | undefined
  onMessageCopyLinkOpen?: ((sid: string) => void) | undefined
  onRetry: () => void
  onSelect: (item: ArkmeMessageCopyLinkExtensionItem) => void
}) {
  const context = state.kind === 'success' ? state.context : undefined
  const byUid = new Map<string, ArkmeMessageCopyLinkExtensionItem>()
  for (const item of optimistic) byUid.set(item.recordUid, item)
  for (const item of context?.extensions ?? []) byUid.set(item.recordUid, item)
  const extensions = [...byUid.values()]
  const extensionCount = Math.max(context?.extensionCount ?? 0, extensions.length)
  if (state.kind === 'loading' && extensions.length === 0) return null
  if (state.kind === 'error' && extensions.length === 0) {
    return <div style={styles.extensionContext}><div role="alert" style={styles.extensionContextStatus}>
      <span>{state.message}</span><button type="button" style={styles.extensionContextRetry} onClick={onRetry}>重试</button>
    </div></div>
  }
  if (extensionCount === 0) return null
  return <section style={styles.extensionContext} aria-label="快记延展列表">
    <div style={styles.extensionContextTitle} data-arkme-note-extension-count="true">共{extensionCount}条延展</div>
    <div style={styles.extensionContextList}>{orderedDetailExtensions(extensions, context?.parentRecordUid ?? '').map(({ item: extension, nested }) => {
      const timelineItem = detailExtensionTimelineItem(extension)
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
        <DetailExtensionAvatar item={extension} size={nested ? 28 : 32} />
        <div style={styles.extensionContextBody}>
          <div style={styles.extensionContextHead}>
            <span style={styles.extensionContextName}>{detailExtensionSenderName(extension)}</span>
            <span style={styles.extensionContextTime}>{[dateLabel(extension.sendAtMillis), timeLabel(extension.sendAtMillis)].filter(Boolean).join(' ')}</span>
          </div>
          <ArkmeMessageContent
            presentation="detail"
            item={timelineItem}
            highlightMentions
            {...(sourceRef === undefined ? {} : { sourceRef })}
            {...(shareWebsite === undefined ? {} : { shareWebsite })}
            {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
          />
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
  item, sourceRef, showOriginal, onClose, onToggleOriginal, shareWebsite, onMessageCopyLinkOpen, onExtensionSent, onToast,
}: {
  item: ArkmeTimelineItem
  sourceRef?: string | undefined
  showOriginal: boolean
  onClose: () => void
  onToggleOriginal: () => void
  shareWebsite?: string
  onMessageCopyLinkOpen?: (sid: string) => void
  onExtensionSent?: (result: ArkmeSourceMessageExtendResult) => void
  onToast?: (message: string) => void
}) {
  const [relatedView, setRelatedView] = useState<ArkmeRelatedDrawerView>('source-detail')
  const [relatedState, setRelatedState] = useState<ArkmeRelatedQuickNotesLoadState>({ kind: 'idle' })
  const [relatedDetailState, setRelatedDetailState] = useState<ArkmeRelatedQuickNoteDetailState>({ kind: 'idle' })
  const listAbortRef = useRef<AbortController>()
  const detailAbortRef = useRef<AbortController>()
  const extensionAbortRef = useRef<AbortController>()
  const [extensionState, setExtensionState] = useState<ArkmeDetailExtensionLoadState>({ kind: 'idle' })
  const [optimisticExtensions, setOptimisticExtensions] = useState<ArkmeMessageCopyLinkExtensionItem[]>([])
  const [selectedExtensionRecordUid, setSelectedExtensionRecordUid] = useState<string>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopByViewRef = useRef<Record<ArkmeRelatedDrawerView, number>>({
    'source-detail': 0,
    'related-list': 0,
    'related-detail': 0,
  })
  const messageActionRef = item.messageActionRef?.trim() ?? ''
  const normalizedSourceRef = sourceRef?.trim() ?? ''
  const loadRelated = useCallback(() => {
    listAbortRef.current?.abort()
    if (normalizedSourceRef === '' || messageActionRef === '') {
      setRelatedState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    listAbortRef.current = controller
    setRelatedState({ kind: 'loading' })
    void callArkme<ArkmeRelatedQuickNoteList>('source.related-quick-notes.from-message', {
      sourceRef: normalizedSourceRef,
      messageActionRef,
    }, controller.signal).then(list => {
      if (controller.signal.aborted || listAbortRef.current !== controller) return
      setRelatedState(list.items.length === 0 ? { kind: 'empty' } : { kind: 'success', list })
    }).catch(error => {
      if (controller.signal.aborted || listAbortRef.current !== controller) return
      setRelatedState({ kind: 'error', message: relatedQuickNoteErrorMessage(error, '相关快记加载失败') })
    })
  }, [messageActionRef, normalizedSourceRef])
  const loadExtensionContext = useCallback(() => {
    extensionAbortRef.current?.abort()
    if (normalizedSourceRef === '' || messageActionRef === '') {
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
  }, [messageActionRef, normalizedSourceRef])
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
    setRelatedView('source-detail')
    setRelatedState({ kind: 'idle' })
    setRelatedDetailState({ kind: 'idle' })
    setExtensionState({ kind: 'idle' })
    setOptimisticExtensions([])
    setSelectedExtensionRecordUid(undefined)
    scrollTopByViewRef.current = { 'source-detail': 0, 'related-list': 0, 'related-detail': 0 }
    loadRelated()
    loadExtensionContext()
    return () => {
      listAbortRef.current?.abort()
      detailAbortRef.current?.abort()
      extensionAbortRef.current?.abort()
    }
  }, [item.itemUid, loadExtensionContext, loadRelated])
  useEffect(() => {
    if (bodyRef.current !== null) bodyRef.current.scrollTop = scrollTopByViewRef.current[relatedView]
  }, [relatedView])
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
  const backRelated = () => {
    if (relatedView === 'related-detail') detailAbortRef.current?.abort()
    navigateRelated(relatedDrawerBackTarget(relatedView))
  }
  const textContent = showOriginal && item.aiPolish?.originalText !== undefined ? item.aiPolish.originalText
    : item.aiPolish?.state === 'polished' && item.aiPolish.polishedText !== undefined ? item.aiPolish.polishedText : item.textContent
  const canToggle = item.aiPolish?.state === 'polished' && item.aiPolish.originalText !== undefined && item.aiPolish.polishedText !== undefined
  const extensionFooter = normalizedSourceRef === '' || messageActionRef === '' ? undefined : <DetailExtensionComposer
    sourceRef={normalizedSourceRef}
    messageActionRef={messageActionRef}
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
    return <NoteDetailShell title={`${String(total)} 条相关快记`} label="相关快记列表"
      onClose={closeDrawer} onBack={backRelated} backLabel="返回快记详情" bodyRef={bodyRef} footer={extensionFooter}>
      <div>
        <ArkmeRelatedQuickNotesList state={relatedState}
          onRetry={loadRelated}
          onSelect={relatedItem => {
            navigateRelated('related-detail')
            loadRelatedDetail(relatedItem)
          }} />
      </div>
    </NoteDetailShell>
  }
  if (relatedView === 'related-detail') {
    return <NoteDetailShell title="相关快记详情" label="相关快记详情"
      onClose={closeDrawer} onBack={backRelated} backLabel="返回相关快记列表" bodyRef={bodyRef} footer={extensionFooter}>
      <ArkmeRelatedQuickNoteDetail
        state={relatedDetailState}
        onRetry={loadRelatedDetail}
        {...(normalizedSourceRef === '' ? {} : { sourceRef: normalizedSourceRef })}
        {...(shareWebsite === undefined ? {} : { shareWebsite })}
        {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
      />
    </NoteDetailShell>
  }
  return <NoteDetailShell title="快记详情" label="快记详情" onClose={closeDrawer} bodyRef={bodyRef} footer={extensionFooter}>
    <div style={{ ...styles.row, alignItems: 'center', marginBottom: 20 }}>
      <ArkmeUserAvatar {...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef })} size={40} label="作者头像" />
      <div style={styles.content}><div style={styles.name}>{arkmeTimelineDetailSenderText(item)}</div>
        <div style={{ ...styles.time, marginTop: 4 }}>{[dateLabel(item.sendAtMillis), timeLabel(item.sendAtMillis)].filter(Boolean).join(' ')}</div>
      </div>
    </div>
    {canToggle && <button type="button" style={styles.toggle} onClick={onToggleOriginal}>{showOriginal ? '显示润色' : '显示原文'}</button>}
    <div data-arkme-timeline-detail-rich-content>
      <ArkmeMessageContent
        presentation="detail"
        item={{ ...item, textContent }}
        highlightMentions
        {...(sourceRef === undefined ? {} : { sourceRef })}
        {...(shareWebsite === undefined ? {} : { shareWebsite })}
        {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
      />
    </div>
    {item.extensionParent !== undefined && <DetailExtensionParent parent={item.extensionParent} />}
    <ArkmeRelatedQuickNotesCard
      state={relatedState}
      onOpen={() => { navigateRelated('related-list') }}
      onRetry={loadRelated}
    />
    <DetailExtensionContext
      state={extensionState}
      optimistic={optimisticExtensions}
      {...(selectedExtensionRecordUid === undefined ? {} : { selectedRecordUid: selectedExtensionRecordUid })}
      {...(sourceRef === undefined ? {} : { sourceRef })}
      {...(shareWebsite === undefined ? {} : { shareWebsite })}
      {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
      onRetry={loadExtensionContext}
      onSelect={extension => { setSelectedExtensionRecordUid(extension.recordUid) }}
    />
  </NoteDetailShell>
}

function ForwardDetailRow({ name, time, avatarRef, segment = false, children }: {
  name: string; time: string; avatarRef?: string | undefined; segment?: boolean; children: ReactNode
}) {
  return <div style={styles.row} {...(segment ? { 'data-arkme-forward-segment': 'true' } : {})}>
    <ArkmeUserAvatar {...(avatarRef === undefined ? {} : { avatarRef })} size={30} label={segment ? '转写说话人头像' : '转发消息头像'} />
    <div style={styles.content}>
      <div style={styles.meta}><span style={styles.name}>{name}</span><span style={styles.time}>{time}</span></div>
      {children}
    </div>
  </div>
}

export function ForwardRecordsDetail({ item, onClose }: { item: ArkmeTimelineItem; onClose: () => void }) {
  const forward = item.forwardRecords
  if (forward === undefined) return null
  const dates = forward.items.map(value => epoch(value.sendAtMillis)).filter(value => value > 0)
  const firstDate = dateLabel(dates.length ? Math.min(...dates) : forward.createdAtMillis)
  const lastDate = dateLabel(dates.length ? Math.max(...dates) : forward.createdAtMillis)
  const rows: ArkmeForwardRecordPreviewItem[] = forward.items.length ? forward.items : forward.summaryLines.map(line => {
    const separator = line.search(/[：:]/u)
    return { senderName: separator > 0 ? line.slice(0, separator) : item.senderName, sendAtMillis: 0, title: '', textContent: separator > 0 ? line.slice(separator + 1) : line }
  })
  const renderRecord = (value: ArkmeForwardRecordPreviewItem, index: number) => {
    const segments = value.segments ?? []
    const joinedTranscript = segments.map(segment => segment.textContent).join('').replace(/\s/gu, '')
    const hasDistinctText = value.textContent.trim() !== '' && value.textContent.replace(/\s/gu, '') !== joinedTranscript
    const snapshot: ArkmeTimelineItem = {
      itemUid: `${item.itemUid}-forward-${String(index)}`, senderName: value.senderName, isMe: false, sendAtMillis: value.sendAtMillis,
      status: 1, title: value.title,
      textContent: value.textContent || ((value.contentBlocks?.length ?? 0) === 0 ? value.contentLabel ?? '' : ''),
      ...(value.contentBlocks === undefined ? {} : { contentBlocks: value.contentBlocks }),
      ...(value.mediaUnavailable === undefined ? {} : { mediaUnavailable: value.mediaUnavailable }),
    }
    const hasRecordBody = segments.length === 0 || hasDistinctText || (value.contentBlocks?.length ?? 0) > 0
    return <div key={index} style={styles.rows}>
      {hasRecordBody && <ForwardDetailRow name={value.senderName} avatarRef={value.avatarRef}
        time={`${firstDate !== lastDate ? `${dateLabel(value.sendAtMillis)} ` : ''}${timeLabel(value.sendAtMillis)}`}>
        {segments.length === 0 ? <ArkmeMessageContent item={snapshot} presentation="detail" highlightMentions /> : <>
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
      {segments.length > 0 && value.mediaUnavailable && <p style={styles.notice}>部分媒体暂时无法加载，请刷新对话后重试</p>}
      {value.truncated && <p style={styles.notice}>内容较多，当前展示部分转发内容</p>}
    </div>
  }
  const forwardedAt = [dateLabel(forward.createdAtMillis), timeLabel(forward.createdAtMillis)].filter(Boolean).join(' ')
  return <NoteDetailShell title={forward.title || '转发快记'} label="转发快记详情"
    subtitle={firstDate === lastDate ? firstDate : `${firstDate} 至 ${lastDate}`}
    footer={forwardedAt ? `转发于 ${forwardedAt}` : '转发时间未知'} onClose={onClose}>
    <div style={styles.rows}>{rows.map(renderRecord)}</div>
    {rows.length === 0 && <p style={styles.notice}>原快记暂不可查看</p>}
    {forward.truncated && <p style={styles.notice}>内容较多，当前展示部分转发记录</p>}
  </NoteDetailShell>
}
