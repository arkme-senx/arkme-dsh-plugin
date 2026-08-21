import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeLongArticleDetail, ArkmeLongArticleDraft, ArkmeSourceSendResult, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'

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
  return seconds >= 60 ? `${String(Math.floor(seconds / 60))}分${String(seconds % 60)}秒` : `${String(seconds)}秒`
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
  item?: ArkmeTimelineItem
  onClose: () => void
  onCreated?: (item: ArkmeTimelineItem) => void
  onUpdated?: (detail: ArkmeLongArticleDetail) => void
}

export function ArkmeLongArticleDialog({ sourceRef, item, onClose, onCreated, onUpdated }: ArkmeLongArticleDialogProps) {
  const creating = item === undefined
  const [detail, setDetail] = useState<ArkmeLongArticleDetail>()
  const [loading, setLoading] = useState(!creating)
  const [editing, setEditing] = useState(creating)
  const [title, setTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [durationBaseMillis, setDurationBaseMillis] = useState(0)
  const [startedAtMillis, setStartedAtMillis] = useState(() => creating ? Date.now() : 0)
  const [clockMillis, setClockMillis] = useState(Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
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
  const dirty = title !== originalRef.current.title || textContent !== originalRef.current.textContent

  const draftParams = useMemo(() => ({
    sourceRef,
    ...(item === undefined ? {} : { itemUid: item.itemUid }),
  }), [item, sourceRef])

  const saveDraft = useCallback(async () => {
    const running = startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0
    await callArkme<void>('source.long-article.draft.put', {
      ...draftParams,
      title: titleRef.current,
      textContent: textRef.current,
      durationMillis: durationBaseRef.current + Math.max(0, running),
    })
  }, [draftParams])

  const deleteDraft = useCallback(async () => {
    await callArkme<void>('source.long-article.draft.delete', draftParams)
  }, [draftParams])

  const loadDetail = useCallback(async () => {
    if (item === undefined) return
    setLoading(true)
    setError('')
    try {
      const value = await callArkme<ArkmeLongArticleDetail>('source.long-article.detail', {
        sourceRef, itemUid: item.itemUid,
      })
      setDetail(value)
      setTitle(value.title)
      setTextContent(value.textContent)
      originalRef.current = { title: value.title, textContent: value.textContent }
      setDurationBaseMillis(value.editDurationMillis)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [item, sourceRef])

  useEffect(() => {
    if (!creating) { void loadDetail(); return }
    let active = true
    void callArkme<ArkmeLongArticleDraft | undefined>('source.long-article.draft.get', draftParams)
      .then(draft => {
        if (!active || draft === undefined || (draft.title === '' && draft.textContent === '')) return
        if (window.confirm('发现未发布的长文草稿，是否继续编辑？')) {
          setTitle(draft.title)
          setTextContent(draft.textContent)
          setDurationBaseMillis(draft.durationMillis)
          originalRef.current = { title: draft.title, textContent: draft.textContent }
          setStartedAtMillis(Date.now())
        } else {
          void deleteDraft()
        }
      })
      .catch(() => undefined)
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
      if (titleRef.current !== originalRef.current.title || textRef.current !== originalRef.current.textContent) {
        void saveDraft().catch(() => undefined)
      }
    }, 10000)
    return () => { window.clearInterval(timer) }
  }, [editing, saveDraft])

  useEffect(() => () => {
    if (skipUnmountSaveRef.current) return
    if (titleRef.current === originalRef.current.title && textRef.current === originalRef.current.textContent) return
    void saveDraft().catch(() => undefined)
  }, [saveDraft])

  const requestClose = useCallback(() => {
    if (submitting) return
    if (editing && dirty) {
      const keep = window.confirm('保留这篇长文的未发布修改吗？\n确定：保留草稿；取消：放弃修改。')
      skipUnmountSaveRef.current = true
      if (keep) void saveDraft().finally(onClose)
      else void deleteDraft().finally(onClose)
      return
    }
    skipUnmountSaveRef.current = true
    onClose()
  }, [deleteDraft, dirty, editing, onClose, saveDraft, submitting])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [requestClose])

  const beginEditing = async () => {
    if (detail === undefined || !detail.editable) return
    let nextTitle = detail.title
    let nextText = detail.textContent
    let nextDuration = detail.editDurationMillis
    try {
      const draft = await callArkme<ArkmeLongArticleDraft | undefined>('source.long-article.draft.get', draftParams)
      if (draft !== undefined && (draft.title !== detail.title || draft.textContent !== detail.textContent)
        && window.confirm('发现这篇长文的未发布修改，是否恢复？')) {
        nextTitle = draft.title
        nextText = draft.textContent
        nextDuration = Math.max(detail.editDurationMillis, draft.durationMillis)
      }
    } catch {
      // Draft recovery is best effort; the server detail remains editable.
    }
    setTitle(nextTitle)
    setTextContent(nextText)
    setDurationBaseMillis(nextDuration)
    originalRef.current = { title: detail.title, textContent: detail.textContent }
    setStartedAtMillis(Date.now())
    setClockMillis(Date.now())
    skipUnmountSaveRef.current = false
    setEditing(true)
    setError('')
  }

  const publish = async () => {
    const normalizedTitle = title.trim()
    const normalizedText = textContent.trim()
    if (normalizedTitle === '') { setError('请输入标题'); return }
    if (normalizedText === '') { setError('请输入正文'); return }
    if (normalizedTitle.length > MAX_TITLE_LENGTH) { setError('标题最多100字'); return }
    if (normalizedText.length > MAX_CONTENT_LENGTH) { setError('正文最多40000字'); return }
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      if (creating) {
        const recordUid = crypto.randomUUID()
        const result = await callArkme<ArkmeSourceSendResult>('source.send-rich', {
          sourceRef,
          title: normalizedTitle,
          textContent: normalizedText,
          displayKind: 1,
          thinkingDurationMillis: editingDurationMillis,
          assets: [],
          recordUid,
          relationUid: crypto.randomUUID(),
        })
        skipUnmountSaveRef.current = true
        await deleteDraft()
        onCreated?.({
          itemUid: result.itemUid,
          senderName: '我',
          isMe: true,
          sendAtMillis: Date.now(),
          title: normalizedTitle,
          textContent: normalizedText,
          status: result.status,
          templateKind: 8,
          displayKind: 1,
          version: 1,
          recordDurationMillis: editingDurationMillis,
          editDurationMillis: 0,
          ...(result.sequence === undefined ? {} : { sequence: result.sequence }),
        })
        onClose()
      } else if (detail !== undefined) {
        const updated = await callArkme<ArkmeLongArticleDetail>('source.long-article.update', {
          sourceRef,
          itemUid: detail.itemUid,
          title: normalizedTitle,
          textContent: normalizedText,
          version: detail.version,
          editDurationMillis: editingDurationMillis,
        })
        skipUnmountSaveRef.current = true
        await deleteDraft()
        setDetail(updated)
        setTitle(updated.title)
        setTextContent(updated.textContent)
        setDurationBaseMillis(updated.editDurationMillis)
        setStartedAtMillis(0)
        setEditing(false)
        originalRef.current = { title: updated.title, textContent: updated.textContent }
        skipUnmountSaveRef.current = false
        onUpdated?.(updated)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const titleValue = editing ? title : detail?.title ?? item?.title ?? ''
  const textValue = editing ? textContent : detail?.textContent ?? item?.textContent ?? ''
  const staticDuration = detail?.thinkingDurationMillis
    ?? Math.max(0, (item?.recordDurationMillis ?? 0) + (item?.editDurationMillis ?? 0))
  const metaDuration = editing ? displayedDurationMillis : staticDuration
  const sendAt = detail?.sendAtMillis ?? item?.sendAtMillis ?? 0

  return <div style={styles.overlay} role="dialog" aria-modal="true" aria-label={creating ? '写长文' : '长文详情'} onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
    <article style={styles.dialog} data-arkme-long-article-dialog={creating ? 'create' : editing ? 'edit' : 'detail'}>
      <header style={styles.header}>
        {editing
          ? <input autoFocus style={styles.titleInput} value={title} maxLength={MAX_TITLE_LENGTH} placeholder="请输入标题" aria-label="长文标题" disabled={submitting} onChange={event => { setTitle(event.target.value) }} />
          : <h2 style={styles.titleRead}>{titleValue || '无标题长文'}</h2>}
        <button type="button" style={styles.close} aria-label="关闭长文" disabled={submitting} onClick={requestClose}>×</button>
      </header>
      <div style={styles.metaRow}>
        {!creating && sendAt > 0 && <span style={styles.meta}>▦ {formatDate(sendAt)}</span>}
        <span style={styles.meta}>◷ {formatDuration(metaDuration)}</span>
        <span style={styles.meta}>▤ {String(textValue.length)}字</span>
        {editing
          ? <button type="button" style={{ ...styles.action, opacity: submitting ? .55 : 1 }} disabled={submitting} onClick={() => { void publish() }}>➤ {submitting ? '发布中…' : '发布'}</button>
          : detail?.editable === true && <button type="button" style={styles.action} onClick={() => { void beginEditing() }}>✎ 编辑</button>}
      </div>
      {error !== '' && <div style={styles.error} role="alert">{error}{!creating && detail === undefined && <button type="button" style={styles.retry} onClick={() => { void loadDetail() }}>重试</button>}</div>}
      {loading
        ? <div style={styles.state} role="status">正在加载长文…</div>
        : <div style={styles.body}>
          {editing
            ? <textarea autoFocus={creating} style={styles.bodyInput} value={textContent} maxLength={MAX_CONTENT_LENGTH} placeholder="请输入正文内容" aria-label="长文正文" disabled={submitting} onChange={event => { setTextContent(event.target.value) }} />
            : <p style={styles.bodyRead}>{textValue}</p>}
        </div>}
    </article>
  </div>
}
