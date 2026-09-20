import { arkmeTheme as theme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { ArkmeFileActionToast, useArkmeFileActionNotice } from './ArkmeFileViewer.js'
import { ArkmeLongArticleBody, articleImageUrl } from './ArkmeLongArticleBody.js'
import { ArkmeLongArticleEditor, type ArkmeArticleEditorValue } from './ArkmeLongArticleEditor.js'
import { arkmePlainEditorDocument } from './markdown-editor.js'
import { arkmeMarkdownPlainText } from '../markdown.js'
import { arkmeAuthStore } from './auth-store.js'
import type { JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeLongArticleDetail, ArkmeLongArticleDraft, ArkmeSourceSendResult, ArkmeTimelineItem, ArkmeProviderCapabilities, ArkmeLongArticleImage } from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { ArkmeRichText } from './ArkmeRichText.js'

const MAX_TITLE_LENGTH = 100
const MAX_CONTENT_LENGTH = 40000

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: '5vh 4vw', boxSizing: 'border-box', background: 'rgba(0,0,0,.52)' },
  dialog: { width: 'clamp(640px, 70vw, 1100px)', maxWidth: '92vw', height: 'min(820px, 86vh)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 16, background: 'var(--dsw-specific-input-major, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)', boxShadow: '0 24px 72px rgba(0,0,0,.28)' },
  header: { position: 'relative', flex: 'none', padding: '28px 64px 18px 32px' },
  titleInput: { width: '100%', border: 0, outline: 0, padding: 0, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 28, lineHeight: '38px', fontWeight: 650 },
  titleRead: { margin: 0, overflowWrap: 'anywhere', fontSize: 28, lineHeight: '38px', fontWeight: 650 },
  close: { position: 'absolute', top: 24, right: 28, width: 32, height: 32, border: 0, borderRadius: 8, padding: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68707c)', cursor: 'pointer', fontSize: 30, lineHeight: '30px' },
  metaRow: { minHeight: 42, display: 'flex', alignItems: 'center', gap: 20, padding: '0 32px 14px', borderBottom: '1px solid var(--dsw-alias-divider, rgba(127,127,127,.14))', color: 'var(--dsw-alias-label-tertiary, #9399a3)', fontSize: 14 },
  meta: { display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' },
  action: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, padding: '7px 8px', borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-state-business-primary, #8295e8)', cursor: 'pointer', font: 'inherit', fontSize: 16, fontWeight: 600 },
  body: { minHeight: 0, flex: 1, padding: '28px 32px 36px', overflowY: 'auto' },
  bodyInput: { width: '100%', height: '100%', minHeight: 260, resize: 'none', border: 0, outline: 0, padding: 0, boxSizing: 'border-box', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 17, lineHeight: '29px' },
  bodyRead: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 17, lineHeight: '29px' },
  state: { flex: 1, display: 'grid', placeItems: 'center', padding: 36, color: 'var(--dsw-alias-label-secondary, #68707c)', textAlign: 'center' },
  error: { margin: '12px 32px 0', padding: '9px 12px', borderRadius: 8, background: 'rgba(235,77,75,.10)', color: 'var(--dsw-alias-state-error, #d9363e)', fontSize: 13 },
  retry: { marginLeft: 10, border: 0, padding: 0, background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' },
}

function formatDuration(durationMillis: number): string {
  const seconds = Math.max(0, Math.floor(durationMillis / 1000))
  return seconds >= 60 ? tr("{v0}分{v1}秒", { v0: String(Math.floor(seconds / 60)), v1: String(seconds % 60) }) : tr("{v0}秒", { v0: String(seconds) })
}

function formatDate(value: number): string {
  if (value <= 0) return ''
  const date = new Date(value)
  const two = (part: number) => String(part).padStart(2, '0')
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '长文操作失败，请重试'
}

export interface ArkmeLongArticleDialogProps {
  sourceRef: string
  windowMode?: {
    displayName: string
    editOnOpen?: boolean
    invalidated?: boolean
    verifyAccount: () => Promise<void>
    subscribeClose: (listener: () => void) => () => void
    cancelClose: () => void
  }
  item?: Pick<ArkmeTimelineItem, 'itemUid' | 'title' | 'textContent' | 'sendAtMillis' | 'recordDurationMillis' | 'editDurationMillis' | 'messageActionRef' | 'textFormat' | 'contentBlocks'>
  overlayZIndex?: number
  onClose: () => void
  onCreated?: (item: ArkmeTimelineItem) => void | Promise<void>
  onUpdated?: (detail: ArkmeLongArticleDetail) => void | Promise<void>
  /** Composer mode: save locally and attach a draft; never publish here. */
  onPrepared?: (draft: ArkmeLongArticleDraft) => void
}

/** Forwarded content is a read-only snapshot, not an editable source record. */
export function ArkmeLongArticleSnapshotDialog({ item, onClose, standalone = false }: { item: ArkmeTimelineItem; onClose: () => void; standalone?: boolean }) {
  useArkmeLocale()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [onClose])
  return <div style={{ ...styles.overlay, ...(standalone ? { padding: 0, background: theme.base } : {}) }} role="dialog" aria-modal={standalone ? undefined : true} aria-label={tr("转发长文详情")} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <article style={{ ...styles.dialog, ...(standalone ? { width: "100%", maxWidth: "100%", height: "100%", maxHeight: "100%", borderRadius: 0 } : {}) }} data-arkme-long-article-dialog="snapshot">
      <header style={styles.header}>
        <h2 style={styles.titleRead}><ArkmeRichText text={item.title || '无标题长文'} presentation="preview" /></h2>
        <button data-arkme-feedback="neutral" autoFocus type="button" style={styles.close} aria-label={tr("关闭长文")} onClick={onClose}>×</button>
      </header>
      <div style={styles.metaRow}>
        {item.sendAtMillis > 0 && <span style={styles.meta}>▦ {formatDate(item.sendAtMillis)}</span>}
        <span style={styles.meta}>▤ {String(item.textContent.length)}{tr("字")}</span>
      </div>
      <div style={styles.body}>
        {item.textFormat === 'markdown'
          ? <ArkmeLongArticleBody text={item.textContent} blocks={item.contentBlocks} textStyle={{ fontSize: styles.bodyRead?.fontSize, lineHeight: styles.bodyRead?.lineHeight }} />
          : <p style={styles.bodyRead}><ArkmeRichText text={item.textContent} linkLabelMode="raw" /></p>}
      </div>
    </article>
  </div>
}

export function ArkmeLongArticleDialog({ sourceRef, item, overlayZIndex, onClose, onCreated, onUpdated, onPrepared, windowMode }: ArkmeLongArticleDialogProps) {
  useArkmeLocale()
  const { notice: imageNotice, showNotice: showImageNotice } = useArkmeFileActionNotice(5000)
  const messageActionRef = useRef(item?.messageActionRef)
  messageActionRef.current = item?.messageActionRef
  const itemUid = item?.itemUid
  const creating = item === undefined
  const [detail, setDetail] = useState<ArkmeLongArticleDetail>()
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(creating)
  const [title, setTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [durationBaseMillis, setDurationBaseMillis] = useState(0)
  const [startedAtMillis, setStartedAtMillis] = useState(() => creating ? Date.now() : 0)
  const [clockMillis, setClockMillis] = useState(Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [closePrompt, setClosePrompt] = useState(false)
  const [closingDraft, setClosingDraft] = useState(false)
  const closingDraftRef = useRef(false)
  const submittingRef = useRef(false)
  const [draftState, setDraftState] = useState<'unsaved' | 'saving' | 'saved' | 'failed'>('unsaved')
  const changeRevision = useRef(0)
  const windowModeRef = useRef(windowMode); windowModeRef.current = windowMode
  useEffect(() => {
    if (windowMode?.invalidated) { skipUnmountSaveRef.current = true; setAccountChanged(true); setError('账号已切换，请关闭后重新打开长文') }
  }, [windowMode?.invalidated])
  const [failedReferences, setFailedReferences] = useState<string[]>([])
  const [markdownEnabled, setMarkdownEnabled] = useState(false)
  const [capabilityReady, setCapabilityReady] = useState(false)
  const [capabilityEpoch, setCapabilityEpoch] = useState(0)
  const [draftFormat, setDraftFormat] = useState<'plain' | 'markdown'>('plain')
  const [preparingImages, setPreparingImages] = useState(false)
  const [initialDocument, setInitialDocument] = useState<JSONContent>()
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [article, setArticle] = useState<ArkmeArticleEditorValue>()
  const articleRef = useRef(article); articleRef.current = article
  const imagesRef = useRef<ArkmeLongArticleImage[]>([])
  const baseVersionRef = useRef<number>()
  const ids = useRef<{ recordUid: string; relationUid: string }>()
  const getIds = () => ids.current ??= { recordUid: crypto.randomUUID(), relationUid: crypto.randomUUID() }
  const [accountChanged, setAccountChanged] = useState(false)
  const authAtOpen = useRef(arkmeAuthStore.getSnapshot().auth)
  const [documentDirty, setDocumentDirty] = useState(false)
  const documentDirtyRef = useRef(false)
  const saving = useRef(Promise.resolve())
  const skipUnmountSaveRef = useRef(false)
  const originalRef = useRef({ title: '', textContent: '' })
  const titleRef = useRef(title)
  const textRef = useRef(textContent)
  const durationBaseRef = useRef(durationBaseMillis)
  const startedAtRef = useRef(startedAtMillis)
  titleRef.current = title
  textRef.current = textContent
  durationBaseRef.current = durationBaseMillis
  startedAtRef.current = startedAtMillis

  const elapsedMillis = editing && startedAtMillis > 0 ? Math.max(0, clockMillis - startedAtMillis) : 0
  const editingDurationMillis = durationBaseMillis + elapsedMillis
  const displayedDurationMillis = creating
    ? editingDurationMillis
    : (detail?.recordDurationMillis ?? 0) + editingDurationMillis
  const dirty = documentDirty || title !== originalRef.current.title || textContent !== originalRef.current.textContent

  const draftParams = useMemo(() => ({
    sourceRef,
    ...(itemUid === undefined ? {} : { itemUid }),
  }), [itemUid, sourceRef])

  const saveDraft = useCallback(async () => {
    if (accountChanged || skipUnmountSaveRef.current) return
    const running = startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0
    const value = {
      ...draftParams,
      title: titleRef.current,
      textContent: textRef.current,
      textFormat: articleRef.current ? 'markdown' as const : draftFormat,
      ...(articleRef.current ? { document: articleRef.current.document, images: imagesRef.current } : {}),
      ...(creating ? getIds() : { baseVersion: baseVersionRef.current }),
      durationMillis: durationBaseRef.current + Math.max(0, running),
    }
    const revision = changeRevision.current
    setDraftState('saving')
    saving.current = saving.current.catch(() => {}).then(async () => {
      await windowModeRef.current?.verifyAccount()
      await callArkme<void>('source.long-article.draft.put', value)
    })
    try { await saving.current; if (revision === changeRevision.current) setDraftState('saved') }
    catch (caught) { setDraftState('failed'); throw caught }
  }, [draftParams, accountChanged, draftFormat, creating])

  const deleteDraft = useCallback(async () => {
    await saving.current.catch(() => {})
    await windowModeRef.current?.verifyAccount()
    await callArkme<void>('source.long-article.draft.delete', draftParams)
  }, [draftParams])

  const loadDetail = useCallback(async () => {
    if (itemUid === undefined) return
    setLoading(true)
    setError('')
    try {
      const value = await callArkme<ArkmeLongArticleDetail>('source.long-article.detail', {
        sourceRef, itemUid, messageActionRef: messageActionRef.current,
      })
      setDetail(value)
      setDraftFormat(value.textFormat ?? 'plain')
      setTitle(value.title)
      setTextContent(value.textContent)
      originalRef.current = { title: value.title, textContent: value.textContent }
      setDurationBaseMillis(value.editDurationMillis)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [itemUid, sourceRef])

  useEffect(() => arkmeAuthStore.subscribe(() => {
    const auth = arkmeAuthStore.getSnapshot().auth
    if (authAtOpen.current?.status === 'authenticated' && (auth?.status !== 'authenticated' || auth.userId !== authAtOpen.current.userId || auth.environment !== authAtOpen.current.environment)) {
      skipUnmountSaveRef.current = true
      setAccountChanged(true)
      setError('账号已切换，请关闭后重新打开长文')
    }
  }), [])
  useEffect(() => {
    let active = true
    setCapabilityReady(false)
    void callArkme<ArkmeProviderCapabilities>('provider.capabilities', {}).then(value => { if (active) setMarkdownEnabled(value?.features?.markdownLongArticles === true) }).catch(caught => { if (active) setError(errorMessage(caught)) }).finally(() => { if (active) setCapabilityReady(true) })
    return () => { active = false }
  }, [capabilityEpoch])
  useEffect(() => {
    if (!creating) { void loadDetail(); return }
    let active = true
    void callArkme<ArkmeLongArticleDraft | undefined>('source.long-article.draft.get', draftParams)
      .then(draft => {
        if (!active || draft === undefined || (draft.title === '' && draft.textContent === '' && !draft.document)) return
        if (window.confirm('发现未发布的长文草稿，是否继续编辑？')) {
          setInitialDocument(draft.document ?? (draft.textFormat === 'markdown' ? undefined : arkmePlainEditorDocument(draft.textContent)))
          setDraftFormat(draft.textFormat ?? (draft.images?.length ? 'markdown' : 'plain'))
          imagesRef.current = draft.images ?? []
          if (draft.recordUid && draft.relationUid) ids.current = { recordUid: draft.recordUid, relationUid: draft.relationUid }
          setTitle(draft.title)
          setTextContent(draft.textContent)
          setDurationBaseMillis(draft.durationMillis)
          originalRef.current = { title: draft.title, textContent: draft.textContent }
          setStartedAtMillis(Date.now())
        } else {
          void deleteDraft()
        }
      })
      .catch(caught => { if (active) setError(errorMessage(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [creating, deleteDraft, draftParams, loadDetail])

  useEffect(() => {
    if (!editing) return
    const timer = window.setInterval(() => { setClockMillis(Date.now()) }, 500)
    return () => { window.clearInterval(timer) }
  }, [editing])

  useEffect(() => {
    if (!editing) return
    const timer = window.setInterval(() => {
      if (documentDirtyRef.current || titleRef.current !== originalRef.current.title || textRef.current !== originalRef.current.textContent) {
        void saveDraft().catch(() => undefined)
      }
    }, 10000)
    return () => { window.clearInterval(timer) }
  }, [editing, saveDraft])

  useEffect(() => {
    if (!editing || (!documentDirty && !(windowMode && dirty)) || loading || accountChanged || closingDraft || submitting) return
    const timer = setTimeout(() => { void saveDraft().catch(caught => setError(errorMessage(caught))) }, 300)
    return () => { clearTimeout(timer) }
  }, [article, title, textContent, editing, documentDirty, loading, accountChanged, saveDraft, windowMode, dirty, closingDraft, submitting])

  useEffect(() => () => {
    if (skipUnmountSaveRef.current) return
    if (!documentDirtyRef.current && titleRef.current === originalRef.current.title && textRef.current === originalRef.current.textContent) return
    void saveDraft().catch(() => undefined)
  }, [saveDraft])

  const requestClose = useCallback(() => {
    if (windowMode) {
      if (submitting || preparingImages || closingDraft) { setClosePrompt(true); return }
      if (editing && dirty) { setClosePrompt(true); return }
      skipUnmountSaveRef.current = true; onClose(); return
    }
    if (submitting) return
    if (editing && dirty) {
      const keep = window.confirm('保留这篇长文的未发布修改吗？\n确定：保留草稿；取消：放弃修改。')
      if (keep) void saveDraft().then(() => { skipUnmountSaveRef.current = true; onClose() }).catch(caught => setError(errorMessage(caught)))
      else { skipUnmountSaveRef.current = true; void deleteDraft().then(onClose).catch(caught => { skipUnmountSaveRef.current = false; setError(errorMessage(caught)) }) }
      return
    }
    skipUnmountSaveRef.current = true
    onClose()
  }, [deleteDraft, dirty, editing, onClose, saveDraft, submitting, windowMode, accountChanged, preparingImages, closingDraft])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); if (windowMode && closePrompt && !closingDraft) { setClosePrompt(false); windowMode.cancelClose() } else requestClose() } }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [requestClose, windowMode, closePrompt, closingDraft])

  const requestCloseRef = useRef(requestClose); requestCloseRef.current = requestClose
  useEffect(() => windowMode?.subscribeClose(() => requestCloseRef.current()), [windowMode])
  const finishWindowClose = async (keep: boolean) => {
    if (closingDraftRef.current || submittingRef.current || preparingImages) return
    closingDraftRef.current = true; setClosingDraft(true); setError('')
    try {
      if (keep && accountChanged) throw new Error('账号已切换，无法保存；请保留窗口或复制内容后再关闭')
      if (keep) await saveDraft()
      else if (!accountChanged) await deleteDraft()
      skipUnmountSaveRef.current = true; onClose()
    } catch (caught) { setError(errorMessage(caught)); windowMode?.cancelClose() }
    finally { closingDraftRef.current = false; setClosingDraft(false) }
  }

  const beginEditing = async () => {
    if (detail === undefined || !detail.editable) return
    let nextVersion = detail.version
    let nextTitle = detail.title
    let nextText = detail.textContent
    let nextDuration = detail.editDurationMillis
    let document: JSONContent | undefined = detail.textFormat === 'markdown' ? undefined : arkmePlainEditorDocument(detail.textContent)
    let images: ArkmeLongArticleImage[] = (detail.contentBlocks ?? []).flatMap(block => block.kind === 'image' && block.fileAssetUid ? [{ fileAssetUid: block.fileAssetUid }] : [])
    try {
      const draft = await callArkme<ArkmeLongArticleDraft | undefined>('source.long-article.draft.get', draftParams)
      if (draft !== undefined && (draft.title !== detail.title || draft.textContent !== detail.textContent || draft.document !== undefined)
        && window.confirm('发现这篇长文的未发布修改，是否恢复？')) {
        nextVersion = draft.baseVersion ?? 0
        nextTitle = draft.title
        nextText = draft.textContent
        document = draft.document ?? (draft.textFormat === 'markdown' ? undefined : arkmePlainEditorDocument(draft.textContent))
        setDraftFormat(draft.textFormat ?? detail.textFormat ?? 'plain')
        images = draft.images ?? images
        nextDuration = Math.max(detail.editDurationMillis, draft.durationMillis)
      }
    } catch {
      // Draft recovery is best effort; the server detail remains editable.
    }
    baseVersionRef.current = nextVersion
    setInitialDocument(document)
    imagesRef.current = images
    setArticle(undefined)
    setEditorEpoch(value => value + 1)
    setDocumentDirty(false); documentDirtyRef.current = false
    setTitle(nextTitle)
    setTextContent(nextText)
    setDurationBaseMillis(nextDuration)
    originalRef.current = { title: detail.title, textContent: detail.textContent }
    setStartedAtMillis(Date.now())
    setClockMillis(Date.now())
    skipUnmountSaveRef.current = false
    setEditing(true)
    setError(nextVersion !== detail.version ? '此草稿基于旧版本，正文已有新修改；草稿已保留，请核对后重新编辑。' : '')
  }

  const autoEditStarted = useRef(false)
  useEffect(() => {
    if (windowMode?.editOnOpen && detail?.editable && !loading && !accountChanged && !autoEditStarted.current) { autoEditStarted.current = true; void beginEditing() }
  }, [detail, loading, accountChanged, windowMode?.editOnOpen])

  const publish = async () => {
    if (loading || !capabilityReady || (draftFormat === 'markdown' && !markdownEnabled) || (markdownEnabled && !article)) return
    if (!creating && baseVersionRef.current !== detail?.version) { setError('此草稿基于旧版本，正文已有新修改；草稿已保留，请核对后重新编辑。'); return }
    const normalizedTitle = title.trim()
    const format = article ? 'markdown' : draftFormat
    const normalizedText = format === 'markdown' ? textContent : textContent.trim()
    if (accountChanged || preparingImages) return
    if (article && (article.pendingImages || article.failedImages)) { setError('请等待图片准备完成，或重试、删除失败图片'); return }
    if (normalizedTitle === '') { setError('请输入标题'); return }
    if (normalizedText === '') { setError('请输入正文'); return }
    if (normalizedTitle.length > MAX_TITLE_LENGTH) { setError('标题最多100字'); return }
    if (normalizedText.length > MAX_CONTENT_LENGTH) { setError('正文最多40000字'); return }
    if (submittingRef.current || closingDraftRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setFailedReferences([])
    setError('')
    try {
      await windowModeRef.current?.verifyAccount()
      if (creating) {
        const submissionIds = getIds()
        if (windowModeRef.current) await saveDraft()
        if (onPrepared) {
          await saveDraft()
          const auth = arkmeAuthStore.getSnapshot().auth
          if (authAtOpen.current?.status === 'authenticated' && (auth?.status !== 'authenticated' || auth.userId !== authAtOpen.current.userId || auth.environment !== authAtOpen.current.environment)) throw new Error('账号已切换，请重新打开长文')
          skipUnmountSaveRef.current = true
          onPrepared({ sourceRef, ...submissionIds, title: normalizedTitle, textContent: normalizedText,
            textFormat: format, durationMillis: editingDurationMillis, updatedAtMillis: Date.now(),
            ...(article ? { document: article.document, images: article.images } : {}),
          })
          onClose()
          return
        }
        const result = await callArkme<ArkmeSourceSendResult>(article ? 'source.long-article.publish' : 'source.send-rich', {
          sourceRef,
          title: normalizedTitle,
          textContent: normalizedText,
          displayKind: 1,
          thinkingDurationMillis: editingDurationMillis,
          assets: [],
          ...submissionIds,
          expectedUserId: authAtOpen.current?.userId,
          ...(article ? { textFormat: format, images: article.images, recordDurationMillis: editingDurationMillis } : {}),
        })
        skipUnmountSaveRef.current = true
        await deleteDraft().catch(() => {})
        const confirmed = article ? await callArkme<ArkmeLongArticleDetail>('source.long-article.detail', { sourceRef, itemUid: result.itemUid }).catch(() => undefined) : undefined
        await onCreated?.({
          itemUid: result.itemUid,
          senderName: '我',
          isMe: true,
          sendAtMillis: Date.now(),
          title: normalizedTitle,
          textContent: confirmed?.textContent ?? (article ? arkmeMarkdownPlainText(normalizedText) : normalizedText),
          textFormat: format,
          ...(confirmed?.contentBlocks ? { contentBlocks: confirmed.contentBlocks } : {}),
          status: result.status,
          templateKind: 8,
          displayKind: 1,
          version: 1,
          recordDurationMillis: editingDurationMillis,
          editDurationMillis: 0,
          ...(result.messageActionRef === undefined ? {} : { messageActionRef: result.messageActionRef }),
          ...(result.sequence === undefined ? {} : { sequence: result.sequence }),
        })
        onClose()
      } else if (detail !== undefined) {
        const updated = await callArkme<ArkmeLongArticleDetail>('source.long-article.update', {
          sourceRef,
          itemUid: detail.itemUid,
          title: normalizedTitle,
          textContent: normalizedText,
          ...(article ? { textFormat: format, images: article.images } : {}),
          version: baseVersionRef.current,
          editDurationMillis: editingDurationMillis,
        })
        skipUnmountSaveRef.current = true
        await deleteDraft().catch(() => {})
        setDetail(updated)
        setTitle(updated.title)
        setTextContent(updated.textContent)
        setDurationBaseMillis(updated.editDurationMillis)
        setStartedAtMillis(0)
        setEditing(false)
        setDocumentDirty(false); documentDirtyRef.current = false
        setArticle(undefined)
        originalRef.current = { title: updated.title, textContent: updated.textContent }
        skipUnmountSaveRef.current = false
        await onUpdated?.(updated)
        if (windowMode) onClose()
      }
    } catch (caught) {
      if (caught instanceof ArkmeClientError) setFailedReferences((caught.body.imageFailures ?? []).flatMap(failure => failure.fileRef ? [`arkme-local:${failure.fileRef}`] : failure.fileAssetUid ? [`arkme-asset:${failure.fileAssetUid}`] : []))
      setError(errorMessage(caught))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const titleValue = editing ? title : detail?.title ?? item?.title ?? ''
  const textValue = editing ? textContent : detail?.textContent ?? item?.textContent ?? ''
  const readFormat = detail === undefined ? item?.textFormat : detail.textFormat
  const readBlocks = detail === undefined ? item?.contentBlocks : detail.contentBlocks
  const staticDuration = detail?.thinkingDurationMillis
    ?? Math.max(0, (item?.recordDurationMillis ?? 0) + (item?.editDurationMillis ?? 0))
  const metaDuration = editing ? displayedDurationMillis : staticDuration
  const wordCount = (article || readFormat === 'markdown') ? arkmeMarkdownPlainText(textValue).replace(/\[图片\]/g, '').length : textValue.length
  const sendAt = detail?.sendAtMillis ?? item?.sendAtMillis ?? 0

  const publishAction = <button data-arkme-feedback="neutral" type="button" style={{ ...styles.action, ...(windowMode ? { background: theme.primaryAction, color: theme.onPrimaryAction, padding: '8px 18px', fontSize: 14 } : {}), opacity: submitting ? .55 : 1 }} disabled={loading || !capabilityReady || (draftFormat === 'markdown' && !markdownEnabled) || (markdownEnabled && !article) || submitting || closingDraft || closePrompt || accountChanged || preparingImages || Boolean(article?.pendingImages) || Boolean(article?.failedImages)} onClick={() => { void publish() }}>{windowMode ? (creating ? (submitting ? tr('发送中…') : tr('发送')) : (submitting ? tr('正在保存…') : tr('保存修改'))) : creating && onPrepared ? (submitting ? '正在添加…' : '添加到待发送') : (submitting ? '发布中…' : tr("发布"))}</button>

  return <div style={{ ...styles.overlay, ...(overlayZIndex === undefined ? {} : { zIndex: overlayZIndex }), ...(windowMode ? { padding: 0, background: theme.base } : {}) }} role="dialog" aria-modal={windowMode ? undefined : true} aria-label={creating ? '写长文' : '长文详情'} onClick={event => { event.stopPropagation() }} onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
    <article style={{ ...styles.dialog, ...(windowMode ? { width: '100%', maxWidth: '100%', height: '100%', maxHeight: '100%', borderRadius: 0, boxShadow: 'none', background: theme.base } : {}) }} data-arkme-long-article-dialog={creating ? 'create' : editing ? 'edit' : 'detail'}>
      {windowMode && <div data-arkme-article-window-toolbar style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 32px', borderBottom: `1px solid ${theme.border}` }}><span style={{ flex: 1, minWidth: 0, color: theme.secondary, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creating ? tr('发送到：') : tr('所属会话：')}{windowMode.displayName}</span>{editing && publishAction}</div>}
      <header style={styles.header}>
        {editing
          ? <input autoFocus style={styles.titleInput} value={title} maxLength={MAX_TITLE_LENGTH} placeholder={tr("请输入标题")} aria-label={tr("长文标题")} disabled={submitting || closingDraft || closePrompt} readOnly={accountChanged} onChange={event => { changeRevision.current++; setDraftState('unsaved'); setTitle(event.target.value) }} />
          : <h2 style={styles.titleRead}><ArkmeRichText text={titleValue || '无标题长文'} presentation="preview" /></h2>}
        {!windowMode && <button data-arkme-feedback="neutral" type="button" style={styles.close} aria-label={tr("关闭长文")} disabled={submitting} onClick={requestClose}>×</button>}
      </header>
      <div style={styles.metaRow}>
        {!creating && sendAt > 0 && <span style={styles.meta}>▦ {formatDate(sendAt)}</span>}
        <span style={styles.meta}>◷ {formatDuration(metaDuration)}</span>
        <span style={styles.meta}>▤ {String(wordCount)}{tr("字")}</span>
        {editing
          ? (!windowMode && publishAction)
          : detail?.editable === true && <button data-arkme-feedback="neutral" type="button" style={styles.action} onClick={() => { void beginEditing() }}>{tr("✎ 编辑")}</button>}
      </div>
      {error !== '' && <div style={styles.error} role="alert">{error}{!creating && detail === undefined && <button data-arkme-feedback="neutral" type="button" style={styles.retry} onClick={() => { void loadDetail() }}>{tr("重试")}</button>}</div>}
      {loading || (editing && !capabilityReady)
        ? <div style={styles.state} role="status">{tr("正在加载长文…")}</div>
        : <div style={styles.body}>
          {editing && draftFormat === 'markdown' && !markdownEnabled
            ? <div role="status">{tr("Markdown 长文暂不可编辑，草稿已保留。")}<button type="button" onClick={() => { setCapabilityEpoch(value => value + 1) }}>{tr("重试")}</button></div>
            : editing && markdownEnabled && !accountChanged
            ? <ArkmeLongArticleEditor key={editorEpoch} initialSource={textContent} initialDocument={initialDocument} failedReferences={failedReferences} disabled={submitting || closingDraft || closePrompt} expectedUserId={authAtOpen.current?.userId}
                resolveImage={ref => { const block = detail?.contentBlocks?.find(value => value.kind === 'image' && `arkme-asset:${value.fileAssetUid}` === ref); return block ? articleImageUrl(block) : undefined }}
                onError={message => { showImageNotice({ kind: 'error', message }) }} onPreparingChange={setPreparingImages} onChange={value => {
                  const previous = articleRef.current
                  if (!previous && textRef.current === originalRef.current.textContent) originalRef.current.textContent = value.source
                  articleRef.current = value
                  setDraftFormat('markdown')
                  textRef.current = value.source
                  const imageSet: ArkmeLongArticleImage[] = [...imagesRef.current, ...value.images, ...value.retainedFileRefs.map(fileRef => ({ fileRef }))]
                  imagesRef.current = imageSet.filter((image, index, all) => all.findIndex(other => other.fileRef === image.fileRef && other.fileAssetUid === image.fileAssetUid) === index)
                  setArticle(value); setTextContent(value.source)
                  if (previous && JSON.stringify(previous.document) !== JSON.stringify(value.document)) { changeRevision.current++; setDraftState('unsaved'); setDocumentDirty(true); documentDirtyRef.current = true }
                }} />
            : editing
            ? <textarea autoFocus={creating} style={styles.bodyInput} value={textContent} maxLength={MAX_CONTENT_LENGTH} placeholder={tr("请输入正文内容")} aria-label={tr("长文正文")} disabled={submitting || closingDraft || closePrompt} readOnly={accountChanged} onChange={event => { changeRevision.current++; setDraftState('unsaved'); setTextContent(event.target.value) }} />
            : readFormat === 'markdown' ? <ArkmeLongArticleBody text={textValue} blocks={readBlocks} textStyle={{ fontSize: styles.bodyRead?.fontSize, lineHeight: styles.bodyRead?.lineHeight }} /> : <p style={styles.bodyRead}><ArkmeRichText text={textValue} linkLabelMode="raw" /></p>}
        </div>}
      {windowMode && <footer role="status" style={{ padding: '12px 32px', borderTop: `1px solid ${theme.border}`, color: draftState === 'failed' ? theme.danger : theme.secondary, fontSize: 12 }}>{accountChanged ? tr('账号已切换') : !editing ? tr('只读') : tr(draftState === 'saved' ? '草稿已保存' : draftState === 'saving' ? '正在保存草稿…' : draftState === 'failed' ? '草稿保存失败，请重试' : '未保存')}</footer>}
    </article>
    {windowMode && closePrompt && <div style={{ ...styles.overlay, zIndex: 1300 }}>
      <div role="alertdialog" aria-modal="true" aria-label={tr('关闭长文')} onKeyDown={event => {
        if (event.key !== 'Tab') return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }} style={{ width: 'min(420px, 90vw)', borderRadius: 16, padding: 24, background: theme.base, color: theme.text, boxShadow: theme.shadow }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18 }}>{tr('保留这篇长文的修改？')}</h3>
        <p style={{ color: theme.secondary, fontSize: 14 }}>{tr(accountChanged ? '账号已切换，无法保存；请保留窗口或复制内容后再关闭' : '保存草稿后，可以下次继续编辑。')}</p>
        {error && <p role="alert" style={{ color: theme.danger, fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button autoFocus style={{ ...styles.action, marginLeft: 0, color: theme.text, fontSize: 14 }} disabled={closingDraft} onClick={() => { setClosePrompt(false); windowMode.cancelClose() }}>{tr('继续编辑')}</button>
          <button style={{ ...styles.action, marginLeft: 0, color: theme.danger, fontSize: 14 }} disabled={submitting || preparingImages || closingDraft} onClick={() => { void finishWindowClose(false) }}>{tr('放弃修改')}</button>
          <button style={{ ...styles.action, marginLeft: 0, background: theme.primaryAction, color: theme.onPrimaryAction, padding: '8px 12px', fontSize: 14 }} disabled={submitting || preparingImages || closingDraft || accountChanged} onClick={() => { void finishWindowClose(true) }}>{closingDraft ? tr('正在保存…') : tr('保存并关闭')}</button>
        </div>
      </div>
    </div>}
    <ArkmeFileActionToast notice={imageNotice} style={{ position: 'fixed', left: 24, right: 24, bottom: '12vh', zIndex: 1201 }} />
  </div>
}
