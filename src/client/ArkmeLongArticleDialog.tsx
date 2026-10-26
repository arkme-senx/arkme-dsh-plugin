import { longArticleWindowBridge } from './long-article-window.js'
import { subscribeMessageQuoteInvalidations } from './message-quote-invalidations.js'
import { ArticleAutoPublisher } from './article-auto-publisher.js'
import { ArkmeLongArticleActions } from './ArkmeLongArticleActions.js'
import { ArkmeDictationButton, textareaDictationTarget } from './ArkmeDictationButton.js'
import type { DictationTarget } from './dictation-target.js'
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
import { ArkmeLongArticleDraftDialog } from './ArkmeLongArticleDraftDialog.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { ArkmeLongArticleWorkspace, type ArticleWorkspaceFrame } from './ArkmeLongArticleWorkspace.js'

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
    invalidated?: boolean
    verifyAccount: () => Promise<void>
    subscribeClose: (listener: () => void) => () => void
    cancelClose: () => void
  } | undefined
  item?: Pick<ArkmeTimelineItem, 'itemUid' | 'title' | 'textContent' | 'sendAtMillis' | 'recordDurationMillis' | 'editDurationMillis' | 'messageActionRef' | 'textFormat' | 'contentBlocks' | 'recordOwnerUserId'> | undefined
  overlayZIndex?: number
  initialDirectoryPage?: import('../types.js').ArkmeRecordSearchResult | undefined
  onClose: () => void
  onDeleted?: (itemUid: string, ownerUserId?: ArkmeTimelineItem['recordOwnerUserId']) => void
  onCreated?: (item: ArkmeTimelineItem) => void | Promise<void>
  onUpdated?: (detail: ArkmeLongArticleDetail) => void | Promise<void>
  /** A new native/conversation draft must still be explicitly sent to its recipients. */
  sendOnConfirm?: boolean
  /** Composer mode: save locally and attach a draft; never publish here. */
  onPrepared?: (draft: ArkmeLongArticleDraft) => void
}

/** Forwarded content is a read-only snapshot, not an editable source record. */
export function ArkmeLongArticleSnapshotDialog({ item, onClose, standalone = false, windowMode }: {
  item: ArkmeTimelineItem; onClose: () => void; standalone?: boolean; windowMode?: ArkmeLongArticleDialogProps['windowMode']
}) {
  const props: ArkmeLongArticleDialogProps = { sourceRef: 'snapshot', item, onClose, windowMode }
  return <ArkmeLongArticleWorkspace initial={{ sourceRef: 'snapshot', item }} props={props} standalone={standalone}
    renderArticle={(selection, workspace, close, updated, mode) => selection.sourceRef === 'snapshot'
      ? <ArkmeLongArticleSnapshotContent item={item} onClose={close} workspace={workspace} windowMode={mode} />
      : <ArkmeLongArticleContent key={`${selection.sourceRef}:${selection.item?.itemUid}`} sourceRef={selection.sourceRef} item={selection.item}
          onClose={close} onUpdated={updated} windowMode={mode} workspace={workspace} />} />
}

function ArkmeLongArticleSnapshotContent({ item, onClose, workspace, windowMode }: {
  item: ArkmeTimelineItem; onClose: () => void; workspace: ArticleWorkspaceFrame; windowMode: ArkmeLongArticleDialogProps['windowMode']
}) {
  useArkmeLocale()
  const dismissActions = useRef<(() => boolean)>()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); if (dismissActions.current?.()) { event.preventDefault(); event.stopImmediatePropagation(); return }; if (!workspace.closeTransient()) onClose() } }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [onClose, workspace.closeTransient])
  useEffect(() => workspace.registerClose(onClose), [onClose, workspace.registerClose])
  useEffect(() => windowMode?.subscribeClose(onClose), [windowMode, onClose])
  return <div style={{ height: '100%', minHeight: 0, display: 'flex' }} role="region" aria-label={tr("转发长文详情")}>
    <article style={{ ...styles.dialog, width: '100%', maxWidth: '100%', height: '100%', maxHeight: '100%', borderRadius: 0, boxShadow: 'none', background: theme.base }} data-arkme-long-article-dialog="snapshot">
      <header style={{ ...styles.header, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '20px 24px 14px' }}>
        {workspace.leading}
        <h2 style={{ ...styles.titleRead, flex: 1, minWidth: 0 }}><ArkmeRichText text={item.title || '无标题长文'} presentation="preview" /></h2>
        {workspace.renderTrailing(<ArkmeLongArticleActions sourceRef="snapshot" snapshot={item} dismissRef={dismissActions} onDeleted={() => {}} />)}
      </header>
      <div style={styles.metaRow}>
        {item.sendAtMillis > 0 && <span style={styles.meta}>▦ {formatDate(item.sendAtMillis)}</span>}
        <span style={styles.meta}>▤ {String(item.textContent.length)}{tr("字")}</span>
      </div>
      <div ref={workspace.bodyRef} data-arkme-article-scroll style={styles.body}>
        {item.textFormat === 'markdown'
          ? <ArkmeLongArticleBody text={item.textContent} blocks={item.contentBlocks} textStyle={{ fontSize: styles.bodyRead?.fontSize, lineHeight: styles.bodyRead?.lineHeight }} />
          : <p style={styles.bodyRead}><ArkmeRichText text={item.textContent} linkLabelMode="raw" /></p>}
      </div>
    </article>
  </div>
}

export function ArkmeLongArticleDialog(props: ArkmeLongArticleDialogProps) {
  if (props.onPrepared) return <ArkmeLongArticleContent {...props} />
  return <ArkmeLongArticleWorkspace initial={{ sourceRef: props.sourceRef, ...(props.item ? { item: props.item } : {}) }} props={props}
    renderArticle={(selection, workspace, onClose, onUpdated, windowMode) => <ArkmeLongArticleContent key={`${selection.sourceRef}:${selection.item?.itemUid ?? 'new'}`}
      {...props} sourceRef={selection.sourceRef} item={selection.item} onClose={onClose} onUpdated={onUpdated} windowMode={windowMode} workspace={workspace} />} />
}

function ArkmeLongArticleContent({ sourceRef, item, overlayZIndex, onClose, onCreated, onUpdated, onDeleted, onPrepared, sendOnConfirm, windowMode, workspace }: ArkmeLongArticleDialogProps & { workspace?: ArticleWorkspaceFrame }) {
  useArkmeLocale()
  const { notice: imageNotice, showNotice: showImageNotice } = useArkmeFileActionNotice(5000)
  const messageActionRef = useRef(item?.messageActionRef)
  messageActionRef.current = item?.messageActionRef
  const itemUid = item?.itemUid
  const initialCreating = item === undefined
  const manualCompose = initialCreating && (!!onPrepared || !!sendOnConfirm)
  const publishedUid = useRef(item?.itemUid)
  const creating = !publishedUid.current
  const dismissActions = useRef<(() => boolean)>()
  const [actionBusy, setActionBusy] = useState(false)
  const dismissFormatting = useRef<(() => boolean)>()
  const dictationTargetRef = useRef<(() => DictationTarget | undefined) | undefined>()
  const plainBodyRef = useRef<HTMLTextAreaElement>(null)
  const [dictationBusy, setDictationBusy] = useState(false)
  const [detail, setDetail] = useState<ArkmeLongArticleDetail>()
  const [readDenied, setReadDenied] = useState(false)
  const closeReadRef = useRef(onClose); closeReadRef.current = onClose
  const publishedDetail = useRef(detail); publishedDetail.current = detail
  const detailRequest = useRef<AbortController>()
  useEffect(() => () => detailRequest.current?.abort(), [])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(creating)
  const [title, setTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [durationBaseMillis, setDurationBaseMillis] = useState(0)
  const [startedAtMillis, setStartedAtMillis] = useState(() => creating ? Date.now() : 0)
  const composing = useRef(false)
  const [compositionEpoch, setCompositionEpoch] = useState(0)
  const [publicationFailed, setPublicationFailed] = useState(false)
  const [pendingPublication, setPendingPublication] = useState(false)
  const latestPublication = useRef({ dirty: false, ready: false, publish: async () => {} })
  const publisher = useRef<ArticleAutoPublisher>()
  publisher.current ??= new ArticleAutoPublisher({
    dirty: () => latestPublication.current.dirty, ready: () => latestPublication.current.ready,
    publish: () => latestPublication.current.publish(),
    onError: caught => { setPublicationFailed(true); setError(errorMessage(caught)) },
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [closePrompt, setClosePrompt] = useState(false)
  const [recoveryDraft, setRecoveryDraft] = useState<ArkmeLongArticleDraft>()
  const [draftPreview, setDraftPreview] = useState(false)
  const checkingDraft = useRef(false)
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

  const dirty = documentDirty || title !== originalRef.current.title || textContent !== originalRef.current.textContent

  const draftParams = useMemo(() => ({
    sourceRef,
    ...(itemUid === undefined ? {} : { itemUid }),
  }), [itemUid, sourceRef])

  const saveDraft = useCallback(async () => {
    if (accountChanged || skipUnmountSaveRef.current) return
    const running = startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0
    const value = {
      sourceRef,
      ...(publishedUid.current ? { itemUid: publishedUid.current } : {}),
      ...(!manualCompose ? { autoPublish: true } : {}),
      title: titleRef.current,
      textContent: textRef.current,
      textFormat: articleRef.current ? 'markdown' as const : draftFormat,
      ...(articleRef.current ? { document: articleRef.current.document, images: imagesRef.current } : {}),
      ...(!publishedUid.current ? getIds() : { baseVersion: baseVersionRef.current }),
      durationMillis: durationBaseRef.current + Math.max(0, running),
    }
    const revision = changeRevision.current
    setDraftState('saving')
    saving.current = saving.current.catch(() => {}).then(async () => {
      await windowModeRef.current?.verifyAccount()
      const auth = arkmeAuthStore.getSnapshot().auth, before = authAtOpen.current
      if (before?.status === 'authenticated' && (auth?.status !== 'authenticated' || before.userId !== auth.userId || before.environment !== auth.environment)) throw new Error('账号已切换，请重新打开长文')
      await callArkme<void>('source.long-article.draft.put', value)
    })
    try {
      await saving.current
      if (revision === changeRevision.current) {
        setDraftState('saved')
      }
    }
    catch (caught) { setDraftState('failed'); throw caught }
  }, [sourceRef, accountChanged, draftFormat, manualCompose])

  const deleteDraft = useCallback(async () => {
    await saving.current.catch(() => {})
    await windowModeRef.current?.verifyAccount()
    await callArkme<void>('source.long-article.draft.delete', { sourceRef, ...(publishedUid.current ? { itemUid: publishedUid.current } : {}) })
  }, [sourceRef])

  const loadDetail = useCallback(async () => {
    if (itemUid === undefined) return
    detailRequest.current?.abort()
    const controller = new AbortController(); detailRequest.current = controller
    setLoading(true)
    setError('')
    try {
      const value = await callArkme<ArkmeLongArticleDetail>('source.long-article.detail', {
        sourceRef, itemUid, messageActionRef: messageActionRef.current,
      }, controller.signal)
      const auth = arkmeAuthStore.getSnapshot().auth
      if (controller.signal.aborted || (authAtOpen.current?.status === 'authenticated'
        && (auth?.status !== 'authenticated' || auth.userId !== authAtOpen.current.userId || auth.environment !== authAtOpen.current.environment))) return
      setReadDenied(false)
      setDetail(value)
      setDraftFormat(value.textFormat ?? 'plain')
      setTitle(value.title)
      setTextContent(value.textContent)
      originalRef.current = { title: value.title, textContent: value.textContent }
      setDurationBaseMillis(value.editDurationMillis)
    } catch (caught) {
      if (!controller.signal.aborted) {
        if (messageActionRef.current && (caught as { body?: { retryable?: boolean } } | null)?.body?.retryable === false) {
          setReadDenied(true); setDetail(undefined); skipUnmountSaveRef.current = true; closeReadRef.current()
        }
        setError(errorMessage(caught))
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [itemUid, sourceRef])
  useEffect(() => {
    if (editing || !itemUid || !item?.messageActionRef) return
    return subscribeMessageQuoteInvalidations(() => { void loadDetail() })
  }, [editing, itemUid, item?.messageActionRef, loadDetail])

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
    if (!initialCreating) { void loadDetail(); return }
    let active = true
    void callArkme<ArkmeLongArticleDraft | undefined>('source.long-article.draft.get', draftParams)
      .then(draft => {
        if (!active || draft === undefined || (draft.title === '' && draft.textContent === '' && !draft.document)) return
        {
          setInitialDocument(draft.document ?? (draft.textFormat === 'markdown' ? undefined : arkmePlainEditorDocument(draft.textContent)))
          setDraftFormat(draft.textFormat ?? (draft.images?.length ? 'markdown' : 'plain'))
          imagesRef.current = draft.images ?? []
          if (draft.recordUid && draft.relationUid) ids.current = { recordUid: draft.recordUid, relationUid: draft.relationUid }
          setTitle(draft.title)
          setTextContent(draft.textContent)
          setDurationBaseMillis(draft.durationMillis)
          originalRef.current = draft.autoPublish && !manualCompose ? { title: '', textContent: '' } : { title: draft.title, textContent: draft.textContent }
          if (draft.autoPublish && !manualCompose) { changeRevision.current++; setPendingPublication(true) }
          setStartedAtMillis(Date.now())
        }
      })
      .catch(caught => { if (active) setError(errorMessage(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [initialCreating, deleteDraft, draftParams, loadDetail])

  useEffect(() => {
    if (!editing || !dirty || loading || accountChanged || closingDraft) return
    const timer = setTimeout(() => { void saveDraft().catch(caught => setError(errorMessage(caught))) }, 300)
    return () => { clearTimeout(timer) }
  }, [article, title, textContent, editing, documentDirty, loading, accountChanged, saveDraft, windowMode, dirty, closingDraft, submitting])

  useEffect(() => {
    if (!editing || dirty || pendingPublication || loading || accountChanged || submitting || !changeRevision.current) return
    // Undoing all changes must not leave an older pending draft to reappear later.
    const timer = setTimeout(() => { void deleteDraft().catch(() => {}) }, 300)
    return () => clearTimeout(timer)
  }, [editing, dirty, pendingPublication, loading, accountChanged, submitting, deleteDraft])

  useEffect(() => () => {
    if (skipUnmountSaveRef.current) return
    if (!documentDirtyRef.current && titleRef.current === originalRef.current.title && textRef.current === originalRef.current.textContent) return
    void saveDraft().catch(() => undefined)
  }, [saveDraft])

  const requestClose = useCallback(() => {
    if (actionBusy || closingDraftRef.current) { windowMode?.cancelClose(); workspace?.onLeaveFailed(); return }
    if (accountChanged) { setClosePrompt(true); workspace?.onLeaveFailed(); windowMode?.cancelClose(); return }
    if (!manualCompose) {
      closingDraftRef.current = true; setClosingDraft(true)
      void (async () => {
        try {
          if (latestPublication.current.dirty) await saveDraft()
          // Incomplete new articles remain recoverable drafts rather than invalid empty records.
          if (latestPublication.current.dirty && (!creating || (titleRef.current.trim() && textRef.current.trim()))) await publisher.current!.flush()
          skipUnmountSaveRef.current = true; closeReadRef.current()
        } catch (caught) { setError(errorMessage(caught)); setPublicationFailed(true); workspace?.onLeaveFailed(); windowMode?.cancelClose() }
        finally { closingDraftRef.current = false; setClosingDraft(false) }
      })()
      return
    }
    if (editing && dirty) { setClosePrompt(true); return }
    skipUnmountSaveRef.current = true; closeReadRef.current()
  }, [dirty, editing, onClose, saveDraft, windowMode, accountChanged, creating, manualCompose, actionBusy, workspace?.onLeaveFailed])

  useEffect(() => workspace?.registerClose(requestClose), [workspace?.registerClose, requestClose])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); if (dismissFormatting.current?.() || dismissActions.current?.()) { event.preventDefault(); event.stopImmediatePropagation(); return }; if (recoveryDraft) { if (draftPreview) setDraftPreview(false); else { setRecoveryDraft(undefined); enterEditing() } } else if (closePrompt && !closingDraft) { setClosePrompt(false); windowMode?.cancelClose() } else if (!workspace?.closeTransient()) requestClose() } }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [requestClose, windowMode, closePrompt, closingDraft, recoveryDraft, draftPreview, workspace?.closeTransient])

  const requestCloseRef = useRef(requestClose); requestCloseRef.current = requestClose
  useEffect(() => windowMode?.subscribeClose(() => requestCloseRef.current()), [windowMode])
  const finishWindowClose = async (keep: boolean) => {
    if (closingDraftRef.current || submittingRef.current || preparingImages) return
    closingDraftRef.current = true; setClosingDraft(true); setError('')
    try {
      if (keep && accountChanged) throw new Error('账号已切换，无法保存；请保留窗口或复制内容后再关闭')
      if (keep) await saveDraft()
      else if (!accountChanged) await deleteDraft()
      skipUnmountSaveRef.current = true; closeReadRef.current()
    } catch (caught) { setError(errorMessage(caught)); windowMode?.cancelClose() }
    finally { closingDraftRef.current = false; setClosingDraft(false) }
  }

  const beginEditing = async () => {
    if (detail === undefined || !detail.editable || accountChanged || checkingDraft.current) return
    checkingDraft.current = true
    try {
      const draft = await callArkme<ArkmeLongArticleDraft | undefined>('source.long-article.draft.get', draftParams)
      if (skipUnmountSaveRef.current) return
      if (draft !== undefined && (draft.title !== detail.title || draft.textContent !== detail.textContent || draft.document !== undefined)) {
        if (draft.autoPublish && draft.baseVersion === detail.version) { enterEditing(draft); return }
        setDraftPreview(false)
        setRecoveryDraft(draft)
        return
      }
    } catch {
      // Draft recovery is best effort; the server detail remains editable.
    } finally { checkingDraft.current = false }
    enterEditing()
  }

  const enterEditing = (draft?: ArkmeLongArticleDraft) => {
    if (detail === undefined || !detail.editable || accountChanged || skipUnmountSaveRef.current) return
    const nextVersion = draft ? draft.baseVersion ?? 0 : detail.version
    const nextTitle = draft?.title ?? detail.title
    const nextText = draft?.textContent ?? detail.textContent
    const nextDuration = draft ? Math.max(detail.editDurationMillis, draft.durationMillis) : detail.editDurationMillis
    const format = draft?.textFormat ?? detail.textFormat ?? 'plain'
    const document = draft?.document ?? (format === 'markdown' ? undefined : arkmePlainEditorDocument(nextText))
    const images = draft?.images ?? (detail.contentBlocks ?? []).flatMap(block => block.kind === 'image' && block.fileAssetUid ? [{ fileAssetUid: block.fileAssetUid }] : [])
    setDraftFormat(format)
    setRecoveryDraft(undefined)
    setDraftPreview(false)
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
    skipUnmountSaveRef.current = false
    setEditing(true)
    if (draft) { changeRevision.current++; setPendingPublication(true) }
    setError(nextVersion !== detail.version ? '此草稿基于旧版本，正文已有新修改；草稿已保留，请核对后重新编辑。' : '')
  }

  useEffect(() => { if (!loading && detail?.editable && !editing && !recoveryDraft) void beginEditing() }, [loading, detail?.editable, editing])

  const publish = async () => {
    if (submittingRef.current) return
    if (dictationBusy || composing.current) throw new Error('请等待当前输入完成')
    if (loading || !capabilityReady || (draftFormat === 'markdown' && !markdownEnabled) || (markdownEnabled && !articleRef.current)) throw new Error('编辑器尚未准备完成')
    if (accountChanged || skipUnmountSaveRef.current) throw new Error('账号已切换，请重新打开长文')
    if (publishedUid.current && baseVersionRef.current !== publishedDetail.current?.version) throw new Error('长文已在其他位置更新，修改已保存在本机，请核对版本后继续')
    const value = articleRef.current
    if (preparingImages || value?.pendingImages || value?.failedImages) throw new Error('请等待图片准备完成，或重试、删除失败图片')
    const normalizedTitle = titleRef.current.trim(), format = value ? 'markdown' : draftFormat
    const normalizedText = format === 'markdown' ? textRef.current : textRef.current.trim()
    if (!normalizedTitle) throw new Error('请输入标题')
    if (!normalizedText) throw new Error('请输入正文')
    if (normalizedTitle.length > MAX_TITLE_LENGTH || normalizedText.length > MAX_CONTENT_LENGTH) throw new Error('标题最多100字，正文最多40000字')
    const revision = changeRevision.current, submittedAt = Date.now()
    const localTitle = titleRef.current, localText = textRef.current
    const duration = durationBaseRef.current + (startedAtRef.current > 0 ? Math.max(0, Date.now() - startedAtRef.current) : 0)
    const firstPublish = !publishedUid.current
    submittingRef.current = true; setSubmitting(true); setError(''); setFailedReferences([])
    try {
      await windowModeRef.current?.verifyAccount()
      // Persist before the network write. A failed/uncertain request never loses local edits.
      await saveDraft()
      if (skipUnmountSaveRef.current) throw new Error('账号已切换，请重新打开长文')
      if (onPrepared) {
        const submissionIds = getIds()
        onPrepared({ sourceRef, ...submissionIds, title: normalizedTitle, textContent: normalizedText,
          textFormat: format, durationMillis: duration, updatedAtMillis: Date.now(),
          ...(value ? { document: value.document, images: value.images } : {}) })
        skipUnmountSaveRef.current = true; closeReadRef.current(); return
      }
      let updated: ArkmeLongArticleDetail
      if (firstPublish) {
        const result = await callArkme<ArkmeSourceSendResult>(value ? 'source.long-article.publish' : 'source.send-rich', {
          sourceRef, title: normalizedTitle, textContent: normalizedText, displayKind: 1,
          thinkingDurationMillis: duration, assets: [], ...getIds(), expectedUserId: authAtOpen.current?.userId,
          ...(value ? { textFormat: format, images: value.images, recordDurationMillis: duration } : {}),
        })
        if (skipUnmountSaveRef.current) throw new Error('账号已切换，请重新打开长文')
        publishedUid.current = result.itemUid
        updated = { sourceRef, itemUid: result.itemUid, title: normalizedTitle, textContent: normalizedText, textFormat: format,
          sendAtMillis: Date.now(), updateAtMillis: Date.now(), version: 1, editable: true,
          recordDurationMillis: duration, editDurationMillis: 0, thinkingDurationMillis: duration }
        // Detail hydration is best effort after a confirmed create. Never create it a second time.
        updated = await callArkme<ArkmeLongArticleDetail>('source.long-article.detail', { sourceRef, itemUid: result.itemUid }).catch(() => undefined) ?? updated
        const created: ArkmeTimelineItem = { itemUid: result.itemUid, senderName: '我', isMe: true, sendAtMillis: updated.sendAtMillis,
          title: updated.title, textContent: updated.textContent, textFormat: format, ...(updated.contentBlocks ? { contentBlocks: updated.contentBlocks } : {}),
          status: result.status, templateKind: 8, displayKind: 1, version: 1, recordVersion: updated.version,
          recordDurationMillis: duration, editDurationMillis: 0, ...(result.messageActionRef ? { messageActionRef: result.messageActionRef } : {}), ...(result.sequence === undefined ? {} : { sequence: result.sequence }) }
        updated.actionItem ??= created
        baseVersionRef.current = updated.version
        publishedDetail.current = updated; setDetail(updated)
        const receipt = Promise.resolve().then(() => onCreated?.(created)).catch(() => showImageNotice({ kind: 'error', message: '长文已发布，列表更新失败，请重新打开核对' }))
        if (manualCompose) await receipt
      } else {
        updated = await callArkme<ArkmeLongArticleDetail>('source.long-article.update', {
          sourceRef, itemUid: publishedUid.current, title: normalizedTitle, textContent: normalizedText,
          ...(value ? { textFormat: format, images: value.images } : {}), version: baseVersionRef.current,
          editDurationMillis: duration,
        })
      }
      if (skipUnmountSaveRef.current) throw new Error('账号已切换，请重新打开长文')
      publishedDetail.current = updated
      baseVersionRef.current = updated.version
      originalRef.current = { title: localTitle, textContent: localText }
      durationBaseRef.current = firstPublish ? 0 : duration
      startedAtRef.current = submittedAt
      setDurationBaseMillis(durationBaseRef.current); setStartedAtMillis(submittedAt)
      setDetail(updated)
      // A receipt acknowledges its snapshot, not whatever the user has typed since.
      if (revision === changeRevision.current) {
        documentDirtyRef.current = false; setDocumentDirty(false); setPendingPublication(false)
        latestPublication.current.dirty = false
        await deleteDraft().catch(() => {})
      } else {
        await saveDraft()
      }
      // Only remove the new-record slot after any newer edits have a durable
      // confirmed-record draft. A failed migration keeps the original backup.
      if (firstPublish) await callArkme<void>('source.long-article.draft.delete', { sourceRef, expectedRecordUid: getIds().recordUid }).catch(() => {})
      setPublicationFailed(false)
      if (windowMode && longArticleWindowBridge()?.version === 3) void longArticleWindowBridge()?.changed?.()
      if (!manualCompose) void Promise.resolve().then(() => onUpdated?.(updated)).catch(() => showImageNotice({ kind: 'error', message: '长文已发布，列表更新失败，请重新打开核对' }))
      if (manualCompose) { skipUnmountSaveRef.current = true; closeReadRef.current() }
    } catch (caught) {
      if (caught instanceof ArkmeClientError) setFailedReferences((caught.body.imageFailures ?? []).flatMap(failure => failure.fileRef ? [`arkme-local:${failure.fileRef}`] : failure.fileAssetUid ? [`arkme-asset:${failure.fileAssetUid}`] : []))
      throw caught
    } finally { submittingRef.current = false; setSubmitting(false) }
  }
  latestPublication.current = {
    dirty: editing && (dirty || pendingPublication),
    ready: editing && !loading && capabilityReady && !accountChanged && !recoveryDraft && !dictationBusy && !composing.current
      && !preparingImages && (!markdownEnabled || !!article) && !(draftFormat === 'markdown' && !markdownEnabled)
      && !article?.pendingImages && !article?.failedImages && !!title.trim() && !!textContent.trim(),
    publish,
  }
  useEffect(() => {
    if (manualCompose) return
    publisher.current!.changed()
  }, [title, textContent, documentDirty, pendingPublication])
  useEffect(() => {
    if (!dirty && !pendingPublication && !submitting && publicationFailed) { setPublicationFailed(false); setError('') }
  }, [dirty, pendingPublication, submitting, publicationFailed])
  useEffect(() => { if (!manualCompose) publisher.current!.readyChanged() }, [compositionEpoch, preparingImages, dictationBusy, capabilityReady, article?.pendingImages, article?.failedImages, editing, loading])
  const flushRef = useRef<() => Promise<void>>(async () => {}); flushRef.current = () => publisher.current!.flush()
  useEffect(() => {
    if (manualCompose) return
    const recover = () => { if (!composing.current) void flushRef.current().catch(() => {}) }
    const hiding = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') recover() }
    window.addEventListener('online', recover); window.addEventListener('pagehide', recover)
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', hiding)
    return () => {
      window.removeEventListener('online', recover); window.removeEventListener('pagehide', recover)
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', hiding)
      // Section navigation unmounts the overlay; the serial writer completes independently.
      if (!skipUnmountSaveRef.current) recover()
      publisher.current!.stop()
    }
  }, [manualCompose])

  const hideRead = !editing && (readDenied || accountChanged)
  const titleValue = hideRead ? '' : editing ? title : detail?.title ?? item?.title ?? ''
  const textValue = hideRead ? '' : editing ? textContent : detail?.textContent ?? item?.textContent ?? ''
  const readFormat = detail === undefined ? item?.textFormat : detail.textFormat
  const readBlocks = hideRead ? undefined : detail === undefined ? item?.contentBlocks : detail.contentBlocks
  const wordCount = (article || readFormat === 'markdown') ? arkmeMarkdownPlainText(textValue).replace(/\[图片\]/g, '').length : textValue.length
  const sendAt = detail?.sendAtMillis ?? item?.sendAtMillis ?? 0
  const articleStats = <span style={styles.meta}>▤ {String(wordCount)}{tr("字")}</span>
  const publicationStatus = <span role="status" aria-live="polite" data-arkme-article-publication style={{ marginLeft: 'auto', color: publicationFailed ? theme.danger : theme.secondary, fontSize: 12 }}>
    {accountChanged ? tr('账号已切换') : !editing ? tr('只读') : manualCompose ? tr(draftState === 'saved' ? '草稿已保存' : draftState === 'saving' ? '正在保存草稿…' : draftState === 'failed' ? '草稿保存失败' : '未保存')
      : submitting ? tr('发布中…') : publicationFailed ? tr('发布失败') : dirty || pendingPublication ? tr('待发布') : creating ? tr('未发布') : tr('已发布')}
    {publicationFailed && !accountChanged && <button type="button" style={styles.retry} onClick={() => { void publisher.current!.flush().catch(() => {}) }}>{tr('重试')}</button>}
  </span>
  const moreActions = !manualCompose && <ArkmeLongArticleActions sourceRef={sourceRef} detail={detail} dismissRef={dismissActions} onBusyChange={setActionBusy}
    beforeAction={async () => { await publisher.current!.flush(); return publishedDetail.current }}
    onDeleted={uid => { if (windowMode) void longArticleWindowBridge()?.changed?.(); skipUnmountSaveRef.current = true; publisher.current!.stop(); const owner = detail?.actionItem?.recordOwnerUserId ?? item?.recordOwnerUserId; if (owner === undefined) onDeleted?.(uid); else onDeleted?.(uid, owner); onClose() }} />
  const publishAction = <button data-arkme-feedback="neutral" type="button" style={{ ...styles.action, ...(windowMode ? { background: theme.primaryAction, color: theme.onPrimaryAction, padding: '8px 18px', fontSize: 14 } : {}), opacity: submitting ? .55 : 1 }} disabled={dictationBusy || loading || !capabilityReady || (draftFormat === 'markdown' && !markdownEnabled) || (markdownEnabled && !article) || submitting || closingDraft || closePrompt || accountChanged || preparingImages || Boolean(article?.pendingImages) || Boolean(article?.failedImages)} onClick={() => { void publish().catch(caught => { setError(errorMessage(caught)) }) }}>{windowMode ? (creating ? (submitting ? tr('发送中…') : tr('发送')) : (submitting ? tr('正在保存…') : tr('确认修改'))) : creating && onPrepared ? (submitting ? '正在添加…' : '添加到待发送') : (submitting ? '发布中…' : tr("发布"))}</button>

  return <div style={{ ...styles.overlay, ...(overlayZIndex === undefined ? {} : { zIndex: overlayZIndex }), ...(windowMode ? { padding: 0, background: theme.base } : {}), ...(workspace ? { position: 'relative', inset: 'auto', display: 'flex', height: '100%', minHeight: 0, width: '100%', padding: 0, zIndex: 'auto', background: 'transparent' } : {}) }} role={workspace ? 'region' : 'dialog'} aria-modal={windowMode || workspace ? undefined : true} aria-label={creating ? '写长文' : '长文详情'} onClick={event => { event.stopPropagation() }} onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
    <article style={{ ...styles.dialog, ...(windowMode || workspace ? { width: '100%', maxWidth: '100%', height: '100%', maxHeight: '100%', borderRadius: 0, boxShadow: 'none', background: theme.base } : {}) }} data-arkme-long-article-dialog={creating ? 'create' : editing ? 'edit' : 'detail'}>
      {windowMode && <div data-arkme-article-window-toolbar style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 32px', borderBottom: `1px solid ${theme.border}` }}><span style={{ flex: 1, minWidth: 0, color: theme.secondary, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creating ? tr('发送到：') : tr('所属会话：')}{windowMode.displayName}</span>{editing && manualCompose && publishAction}</div>}
      <header style={{ ...styles.header, ...(windowMode && editing ? { paddingBottom: 12 } : {}), ...(workspace ? { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '20px 24px 14px' } : {}) }}>
        {workspace?.leading}
        <div style={workspace ? { flex: 1, minWidth: 0 } : undefined}>{editing
          ? <input autoFocus style={styles.titleInput} value={title} maxLength={MAX_TITLE_LENGTH} placeholder={tr("请输入标题")} aria-label={tr("长文标题")} disabled={(manualCompose && submitting) || closingDraft || closePrompt} readOnly={accountChanged} onCompositionStart={() => { composing.current = true; setCompositionEpoch(value => value + 1) }} onCompositionEnd={() => { composing.current = false; setCompositionEpoch(value => value + 1) }} onChange={event => { changeRevision.current++; titleRef.current = event.target.value; setDraftState('unsaved'); setTitle(event.target.value) }} />
          : <h2 style={styles.titleRead}><ArkmeRichText text={titleValue || '无标题长文'} presentation="preview" /></h2>}</div>
        {workspace ? workspace.renderTrailing(moreActions) : moreActions}
        {!windowMode && !workspace && <button data-arkme-feedback="neutral" type="button" style={styles.close} aria-label={tr("关闭长文")} disabled={closingDraft} onClick={requestClose}>×</button>}
      </header>
      <div style={styles.metaRow}>
        {!creating && sendAt > 0 && <span style={styles.meta}>▦ {formatDate(sendAt)}</span>}
        {articleStats}
        {manualCompose && !windowMode && publishAction}
        {publicationStatus}
      </div>
      {error !== '' && <div style={styles.error} role="alert">{error}{!creating && detail === undefined && <button data-arkme-feedback="neutral" type="button" style={styles.retry} onClick={() => { void loadDetail() }}>{tr("重试")}</button>}</div>}
      {loading || (editing && !capabilityReady)
        ? <div style={styles.state} role="status">{tr("正在加载长文…")}</div>
        : <div onCompositionStartCapture={() => { composing.current = true; setCompositionEpoch(value => value + 1) }} onCompositionEndCapture={() => { composing.current = false; setCompositionEpoch(value => value + 1) }} ref={workspace?.bodyRef} data-arkme-article-scroll style={{ ...styles.body, ...(windowMode && editing ? { paddingTop: 12 } : {}) }}>
          {editing && draftFormat === 'markdown' && !markdownEnabled
            ? <><div role="status">{tr("Markdown 长文暂不可编辑，草稿已保留。")}<button type="button" onClick={() => { setCapabilityEpoch(value => value + 1) }}>{tr("重试")}</button></div><ArkmeLongArticleBody text={textValue} blocks={readBlocks} /></>
            : editing && markdownEnabled && !accountChanged
            ? <ArkmeLongArticleEditor dismissFormattingRef={dismissFormatting} dictationTargetRef={dictationTargetRef} key={editorEpoch} initialSource={textContent} initialDocument={initialDocument} failedReferences={failedReferences} disabled={(manualCompose && submitting) || closingDraft || closePrompt} expectedUserId={authAtOpen.current?.userId}
                resolveImage={ref => { const block = detail?.contentBlocks?.find(value => value.kind === 'image' && `arkme-asset:${value.fileAssetUid}` === ref); return block ? articleImageUrl(block) : undefined }}
                onError={message => { showImageNotice({ kind: 'error', message }) }} onPreparingChange={setPreparingImages} onChange={value => {
                  const previous = articleRef.current
                  if (!previous && !pendingPublication && textRef.current === originalRef.current.textContent) originalRef.current.textContent = value.source
                  articleRef.current = value
                  setDraftFormat('markdown')
                  textRef.current = value.source
                  const imageSet: ArkmeLongArticleImage[] = [...imagesRef.current, ...value.images, ...value.retainedFileRefs.map(fileRef => ({ fileRef }))]
                  imagesRef.current = imageSet.filter((image, index, all) => all.findIndex(other => other.fileRef === image.fileRef && other.fileAssetUid === image.fileAssetUid) === index)
                  setArticle(value); setTextContent(value.source)
                  if (previous && JSON.stringify(previous.document) !== JSON.stringify(value.document)) { changeRevision.current++; setDraftState('unsaved'); const changed = value.source !== originalRef.current.textContent; setDocumentDirty(changed); documentDirtyRef.current = changed }
                }} />
            : editing
            ? <textarea ref={plainBodyRef} autoFocus={creating} style={styles.bodyInput} value={textContent} maxLength={MAX_CONTENT_LENGTH} placeholder={tr("请输入正文内容")} aria-label={tr("长文正文")} disabled={(manualCompose && submitting) || closingDraft || closePrompt} readOnly={accountChanged} onChange={event => { changeRevision.current++; textRef.current = event.target.value; setDraftState('unsaved'); setTextContent(event.target.value) }} />
            : readFormat === 'markdown' ? <ArkmeLongArticleBody text={textValue} blocks={readBlocks} textStyle={{ fontSize: styles.bodyRead?.fontSize, lineHeight: styles.bodyRead?.lineHeight }} /> : <p style={styles.bodyRead}><ArkmeRichText text={textValue} linkLabelMode="raw" /></p>}
        </div>}
      {(windowMode || editing) && <footer style={{ flex: 'none', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 20px', padding: '12px 32px', borderTop: `1px solid ${theme.border}`, color: theme.secondary, fontSize: 12 }}>
        {editing && <ArkmeDictationButton scopeKey={`article:${editorEpoch}:${authAtOpen.current?.userId}`} disabled={(manualCompose && submitting) || closingDraft || closePrompt || accountChanged || loading}
          getTarget={() => markdownEnabled ? dictationTargetRef.current?.() : textareaDictationTarget(plainBodyRef.current, text => { changeRevision.current++; setDraftState('unsaved'); setTextContent(text) })} onBusyChange={setDictationBusy} />}
      </footer>}
    </article>
    {recoveryDraft && !accountChanged && <ArkmeLongArticleDraftDialog draft={recoveryDraft} blocks={detail?.contentBlocks} preview={draftPreview}
      onPreview={setDraftPreview} onClose={() => { setRecoveryDraft(undefined); setDraftPreview(false); enterEditing() }}
      onOriginal={() => enterEditing()} onRestore={() => enterEditing(recoveryDraft)} />}
    {closePrompt && <div style={{ ...styles.overlay, zIndex: 1300 }}>
      <div role="alertdialog" aria-modal="true" aria-label={tr('关闭长文')} onKeyDown={event => {
        if (event.key !== 'Tab') return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }} style={{ position: 'relative', width: 'min(420px, 90vw)', borderRadius: 16, padding: 24, background: theme.base, color: theme.text, boxShadow: theme.shadow }}>
        <h3 style={{ margin: '0 0 12px', paddingRight: 32, fontSize: 18 }}>{tr('是否暂存草稿')}</h3>
        <button autoFocus type="button" data-arkme-feedback="neutral" aria-label={tr('关闭草稿确认弹窗')} style={{ ...styles.close, top: 18, right: 18 }} disabled={closingDraft} onClick={() => { setClosePrompt(false); windowMode?.cancelClose() }}>×</button>
        <p style={{ color: theme.secondary, fontSize: 14 }}>{tr(accountChanged ? '账号已切换，无法保存；请保留窗口或复制内容后再关闭' : '保存草稿后，可以下次继续编辑。')}</p>
        {error && <p role="alert" style={{ color: theme.danger, fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button style={{ ...styles.action, marginLeft: 0, color: theme.danger, fontSize: 14 }} disabled={submitting || preparingImages || closingDraft} onClick={() => { void finishWindowClose(false) }}>{tr('放弃修改')}</button>
          <button style={{ ...styles.action, marginLeft: 0, background: theme.primaryAction, color: theme.onPrimaryAction, padding: '8px 12px', fontSize: 14 }} disabled={submitting || preparingImages || closingDraft || accountChanged} onClick={() => { void finishWindowClose(true) }}>{closingDraft ? tr('正在保存…') : tr('保存草稿')}</button>
        </div>
      </div>
    </div>}
    <ArkmeFileActionToast notice={imageNotice} style={{ position: 'fixed', left: 24, right: 24, bottom: '12vh', zIndex: 1201 }} />
  </div>
}
