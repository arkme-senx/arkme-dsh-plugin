import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { callArkme } from '../api.js'
import { tr, arkmeIntlLocale } from '../locale.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import type { PublicRecordingImportCurrentSnapshot, PublicRecordingImportHistoryPage } from '../../recording-import-shared.js'
import { recordingImportEndTimeError, recordingImportLocalInputValue } from './ArkmeRecordingImportDialog.js'
import { mergeRecordingFiles, recordingFileDayBounds, recordingFileKey, recordingFileMatchesDay, recordingFileStatusLabel, type RecordingFile } from './recording-day-files.js'

export interface RecordingFilesCount {
  dateStamp: number
  count: number
  complete: boolean
}

interface Props {
  accountKey: string | undefined
  dateStamp: number
  refreshRevision: number
  active: boolean
  onChanged(): void
  onCountChange?(value: RecordingFilesCount): void
}
type Action = { kind: 'delete' | 'start' | 'ownership'; file: RecordingFile }
interface FileRead {
  controller: AbortController
  toMillis: number
  offset: number
  loading: boolean
  resume: boolean
  revision: number
  items: RecordingFile[]
  seen: Set<string>
}
const control: CSSProperties = { minHeight: 32, padding: '5px 10px', border: `1px solid ${theme.border}`, borderRadius: 7, background: theme.base, color: theme.text, font: 'inherit', fontSize: 12 }
const button: CSSProperties = { ...control, cursor: 'pointer' }
const note: CSSProperties = { color: theme.secondary, fontSize: 12, lineHeight: '20px' }
const PAGE_SIZE = 50
const PAGES_PER_BATCH = 10

function instant(value: number, showDate = true) {
  return value > 0 ? new Date(value).toLocaleString(arkmeIntlLocale(), { ...(showDate ? { month: '2-digit', day: '2-digit' } as const : {}), hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
}
function duration(value: number) {
  const seconds = Math.floor(Math.max(0, value) / 1000)
  if (seconds < 60) return tr('{v0}秒', { v0: seconds })
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 === 0 ? tr('{v0}分钟', { v0: minutes }) : tr('{v0}分{v1}秒', { v0: minutes, v1: seconds % 60 })
}
function size(value: number) {
  return value > 0 ? value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB` : '—'
}

/** Account-key remount isolates file actions and late responses across login changes. */
export function ArkmeRecordingFiles(props: Props) {
  return props.accountKey ? <RecordingFiles key={props.accountKey} {...props} /> : <p style={note}>{tr('登录后查看音频文件')}</p>
}

function RecordingFiles({ dateStamp, active, refreshRevision, onChanged, onCountChange }: Props) {
  const [current, setCurrent] = useState<RecordingFile[]>([])
  const [history, setHistory] = useState<RecordingFile[]>([])
  const [currentWarning, setCurrentWarning] = useState('')
  const [currentReadFailed, setCurrentReadFailed] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentLoading, setCurrentLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [revision, setRevision] = useState(0)
  const [action, setAction] = useState<Action>()
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [start, setStart] = useState('')
  const [ownership, setOwnership] = useState<'self' | 'other'>('self')
  const [menu, setMenu] = useState<{ file: RecordingFile; anchor: HTMLButtonElement; left: number; top: number }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const request = useRef<FileRead>()
  const deleted = useRef(new Set<string>())
  const deleting = useRef(false)
  const section = useRef<HTMLElement>(null)
  const restorePosition = useRef<{ scroll: { element: HTMLElement; top: number; left: number }[]; focus: HTMLButtonElement | undefined }>()
  const mutation = useRef<AbortController>()
  const dialog = useRef<HTMLDialogElement>(null)
  const withoutDeleted = (items: readonly RecordingFile[]) => items.filter(file => !deleted.current.has(recordingFileKey(file)))

  useLayoutEffect(() => {
    const saved = restorePosition.current
    if (!saved) return
    restorePosition.current = undefined
    if (saved.focus?.isConnected) saved.focus.focus({ preventScroll: true })
    for (const { element, top, left } of saved.scroll) {
      element.scrollTop = top; element.scrollLeft = left
    }
  })

  const loadHistory = async (context: NonNullable<typeof request.current>) => {
    if (context.loading || context.controller.signal.aborted) return
    if (deleting.current) { context.resume = true; return }
    context.loading = true; setLoading(true); setHistoryError('')
    try {
      for (let pageIndex = 0; pageIndex < PAGES_PER_BATCH; pageIndex++) {
        const readRevision = context.revision
        const page = await withArkmeReadDeadline(signal => callArkme<PublicRecordingImportHistoryPage>('recordings.import.history', {
          toMillis: context.toMillis, limit: PAGE_SIZE, offset: context.offset,
        }, signal), context.controller.signal)
        if (context.controller.signal.aborted) return
        // A deletion can shift offset pagination while this page is in flight.
        // Discard that page and continue from the adjusted cursor.
        if (deleting.current || readRevision !== context.revision) { context.resume = true; return }
        if (page.hasMore && page.items.length === 0) throw new Error(tr('文件列表未能继续加载，请重试'))
        context.offset += page.items.length
        const pageItems = withoutDeleted(page.items)
        context.items = mergeRecordingFiles(context.items, pageItems)
        for (const file of pageItems) context.seen.add(recordingFileKey(file))
        const snapshotItems = context.items
        // Keep the loaded tail during a background refresh. Replace the whole
        // snapshot only when the server confirms the scan is complete.
        setHistory(previous => withoutDeleted(page.hasMore ? mergeRecordingFiles(previous, pageItems) : snapshotItems))
        setHasMore(page.hasMore)
        if (!page.hasMore) break
      }
    } catch (error) {
      if (!context.controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : tr('音频文件加载失败'))
    } finally {
      context.loading = false
      if (!context.controller.signal.aborted) {
        setLoading(false)
        if (context.resume && !deleting.current) { context.resume = false; void loadHistory(context) }
      }
    }
  }

  useEffect(() => {
    if (!active) return
    const context: FileRead = { controller: new AbortController(), toMillis: Date.now(), offset: 0, loading: false, resume: false, revision: 0, items: [], seen: new Set() }
    request.current = context
    setCurrentWarning(''); setCurrentReadFailed(false); setCurrentLoading(true); setHasMore(true)
    void withArkmeReadDeadline(signal => callArkme<PublicRecordingImportCurrentSnapshot>('recordings.import.list', {}, signal), context.controller.signal)
      .then(snapshot => {
        if (context.controller.signal.aborted) return
        setCurrent(withoutDeleted(snapshot.items))
        setCurrentReadFailed(snapshot.owner.state === 'unavailable')
        setCurrentWarning(snapshot.owner.state === 'unavailable' ? tr('部分未完成文件暂未同步，请重试')
          : snapshot.items.length >= 20 ? tr('未完成文件较多，当前仅显示最近任务') : '')
      }).catch(() => { if (!context.controller.signal.aborted) { setCurrentReadFailed(true); setCurrentWarning(tr('未完成文件加载失败，请重试')) } })
      .finally(() => { if (!context.controller.signal.aborted) setCurrentLoading(false) })
    void loadHistory(context)
    return () => { context.controller.abort() }
  }, [active, revision, refreshRevision])
  useEffect(() => () => { mutation.current?.abort() }, [])
  useEffect(() => { setMenu(undefined); if (!busy) { setAction(undefined); setMutationError('') } }, [dateStamp])
  useEffect(() => {
    if (!action) return
    dialog.current?.showModal()
  }, [action])
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector('button')?.focus()
    const close = () => setMenu(undefined)
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !menu.anchor.contains(event.target)) close()
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); menu.anchor.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', close)
    }
  }, [menu])
  // A refresh scans paginated history, so do not repeat it on a timer.
  // External updates keep existing rows visible. Local deletion only removes
  // its confirmed row and lets the calendar refresh independently.
  const files = useMemo(() => mergeRecordingFiles(history, current)
    .filter(file => recordingFileMatchesDay(file, dateStamp, 'recorded'))
    .sort((a, b) => a.startAtMillis - b.startAtMillis || recordingFileKey(a).localeCompare(recordingFileKey(b))), [history, current, dateStamp])
  const openAction = (file: RecordingFile, kind: Action['kind']) => {
    setMenu(undefined)
    setStart(recordingImportLocalInputValue(new Date(file.startAtMillis)))
    setOwnership(file.ownership); setMutationError(''); setNotice(''); setAction({ file, kind })
  }
  const mutate = async () => {
    if (!action || busy) return
    const { file, kind } = action
    const startAtMillis = new Date(start).getTime()
    if (kind === 'start') {
      const error = recordingImportEndTimeError(startAtMillis, file.durationMillis)
      if (error) { setMutationError(tr(error)); return }
    }
    const controller = new AbortController(); mutation.current = controller
    if (kind === 'delete') {
      deleting.current = true
      if (request.current) {
        request.current.revision += 1
        request.current.resume ||= request.current.loading
      }
    }
    setBusy(true); setMutationError('')
    try {
      if ('importRef' in file) {
        if (kind !== 'delete') return
        await callArkme('recordings.import.cancel', { importRef: file.importRef, expectedRevision: file.revision }, controller.signal)
      } else if (kind === 'delete') {
        await callArkme('recordings.import.session.delete', { sessionRef: file.sessionRef }, controller.signal)
      } else if (kind === 'start') {
        await callArkme('recordings.import.session.update-start', { sessionRef: file.sessionRef, startAtMillis }, controller.signal)
      } else {
        await callArkme('recordings.import.session.update-ownership', { sessionRef: file.sessionRef, ownership }, controller.signal)
      }
      if (controller.signal.aborted) return
      if (kind === 'delete') {
        const key = recordingFileKey(file)
        const rows = [...(section.current?.querySelectorAll<HTMLElement>('[data-recording-file-key]') ?? [])]
        const index = rows.findIndex(row => row.dataset.recordingFileKey === key)
        const focus = index < 0 ? undefined : (rows[index + 1] ?? rows[index - 1])?.querySelector<HTMLButtonElement>('button') ?? undefined
        const scroll: { element: HTMLElement; top: number; left: number }[] = []
        for (let element = section.current?.parentElement; element; element = element.parentElement) {
          if (element.scrollTop || element.scrollLeft) scroll.push({ element, top: element.scrollTop, left: element.scrollLeft })
        }
        restorePosition.current = { scroll, focus }
        deleted.current.add(key)
        const context = request.current
        if (context) {
          context.revision += 1
          if (context.seen.delete(key)) context.offset = Math.max(0, context.offset - 1)
          context.items = withoutDeleted(context.items)
        }
        setCurrent(withoutDeleted); setHistory(withoutDeleted)
      } else {
        setRevision(value => value + 1)
      }
      setAction(undefined); setNotice(tr(kind === 'delete' ? '文件已删除' : '文件信息已更新'))
      onChanged()
    } catch (error) {
      if (!controller.signal.aborted) setMutationError(error instanceof Error ? error.message : tr('文件操作失败，请重试'))
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false)
        if (kind === 'delete') {
          deleting.current = false
          const context = request.current
          if (context?.resume && !context.loading) { context.resume = false; void loadHistory(context) }
        }
      }
    }
  }
  const { from, to } = recordingFileDayBounds(dateStamp)
  const complete = !loading && !currentLoading && !hasMore && !historyError && !currentWarning

  useEffect(() => { onCountChange?.({ dateStamp, count: files.length, complete }) }, [dateStamp, files.length, complete, onCountChange])

  return <section ref={section} aria-label={tr('音频文件')} style={{ minWidth: 0, fontSize: 13 }}>
    {notice && <p role="status" style={note}>{notice}</p>}
    {currentWarning && <p role="status" style={note}>{currentWarning}{currentReadFailed && <button type="button" style={{ ...button, marginLeft: 8 }} disabled={loading || currentLoading || busy} onClick={() => setRevision(value => value + 1)}>{tr('重试')}</button>}</p>}
    <ul aria-label={tr('音频文件列表')} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {files.map(file => {
        const crossDay = file.startAtMillis < from || file.endAtMillis >= to
        const attention = ['partial', 'paused', 'cancelled', 'unavailable'].includes(file.status)
        const statusColor = file.status === 'failed' ? theme.danger : attention ? theme.warning : theme.accent
        const statusBackground = file.status === 'failed' ? theme.dangerSoft : attention ? theme.warningSoft : theme.accentSoft
        return <li key={recordingFileKey(file)} data-recording-file-key={recordingFileKey(file)} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, padding: '12px 0', borderBottom: `1px solid ${theme.borderSoft}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div title={file.fileName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '22px', color: theme.text }}>{file.fileName}</div>
            <div style={{ ...note, marginTop: 2, display: 'flex', flexWrap: 'wrap', columnGap: 6 }}>
              <span title={crossDay ? tr('跨日文件，显示完整录音范围') : undefined}>{instant(file.startAtMillis, crossDay)}–{instant(file.endAtMillis, crossDay)}</span>
              <span>· {duration(file.durationMillis)}</span><span>· {size(file.fileSize)}</span><span>· {tr(file.ownership === 'self' ? '我的' : '他人')}</span>
            </div>
          </div>
          {file.status !== 'completed' && <span title={file.statusDetail} style={{ flex: 'none', marginTop: 2, padding: '1px 6px', borderRadius: 5, fontSize: 11, lineHeight: '20px', color: statusColor, background: statusBackground }}>{tr(recordingFileStatusLabel(file))}</span>}
          <button type="button" aria-haspopup="menu" aria-expanded={menu?.file === file} aria-label={tr('管理 {v0}', { v0: file.fileName })} disabled={busy} style={{ ...button, flex: 'none', padding: 2, width: 28, minHeight: 28, display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: theme.secondary }} onClick={event => {
            if (menu?.file === file) { setMenu(undefined); return }
            const anchor = event.currentTarget, rect = anchor.getBoundingClientRect()
            setMenu({ file, anchor, left: Math.max(8, Math.min(rect.right - 168, window.innerWidth - 176)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 128)) })
          }}><DotsThree size={24} /></button>
        </li>
      })}
    </ul>
    {files.length === 0 && <p style={{ ...note, padding: '24px 0', textAlign: 'center' }}>{tr(complete ? '当天暂无音频文件' : '暂未找到当天文件，列表尚未查全')}</p>}
    {(loading || currentLoading) && <p role="status" style={note}>{tr('正在查找音频文件…')}</p>}
    {historyError && <p role="alert" style={{ ...note, color: theme.danger }}>{historyError}</p>}
    {!loading && (hasMore || historyError) && <button type="button" style={{ ...button, marginTop: 12 }} disabled={busy} onClick={() => { if (request.current) void loadHistory(request.current) }}>{tr(historyError ? '重试加载' : '继续查找更早文件')}</button>}
    {menu && createPortal(<div ref={menuRef} role="menu" aria-label={tr('音频文件操作')} style={{ position: 'fixed', left: menu.left, top: menu.top, zIndex: 10000, width: 160, padding: 4, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.menu, color: theme.text, boxShadow: theme.shadow }} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = [...event.currentTarget.querySelectorAll('button')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
      {(['start', 'ownership', 'delete'] as const).filter(kind => !('importRef' in menu.file) || kind === 'delete').map(kind => <button key={kind} role="menuitem" type="button" style={{ ...button, display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: kind === 'delete' ? theme.danger : theme.text }} onClick={() => openAction(menu.file, kind)}>{tr(kind === 'start' ? '修改录音时间' : kind === 'ownership' ? '修改数据归属' : '删除文件')}</button>)}
    </div>, document.body)}
    {action && <dialog ref={dialog} aria-label={tr(action.kind === 'delete' ? '确认删除音频文件' : action.kind === 'start' ? '修改录音时间' : '修改数据归属')}
      onCancel={event => { event.preventDefault(); if (!busy) setAction(undefined) }} style={{ width: 'min(440px, calc(100vw - 48px))', boxSizing: 'border-box', padding: 24, border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.base, color: theme.text, boxShadow: theme.shadow }}>
      <h3 style={{ marginTop: 0 }}>{tr(action.kind === 'delete' ? '删除音频文件' : action.kind === 'start' ? '修改录音时间' : '修改数据归属')}</h3>
      <p style={{ overflowWrap: 'anywhere' }}>{action.file.fileName}</p><p style={note}>{instant(action.file.startAtMillis)} — {instant(action.file.endAtMillis)}</p>
      {action.kind === 'delete' ? <p style={note}>{tr('将删除整份音频及关联录音数据，跨日部分也会受影响。删除后无法恢复。')}</p>
        : action.kind === 'start' ? <label style={note}>{tr('录音开始时间')} <input type="datetime-local" step={1} aria-label={tr('录音开始时间')} value={start} onChange={event => setStart(event.target.value)} disabled={busy} style={control} /></label>
          : <><select aria-label={tr('文件数据归属')} value={ownership} disabled={busy} onChange={event => setOwnership(event.target.value as 'self' | 'other')} style={control}><option value="self">{tr('我的')}</option><option value="other">{tr('他人')}</option></select><p style={note}>{tr('我的数据写入时间轴，他人仅保存')}</p></>}
      {mutationError && <p role="alert" style={{ ...note, color: theme.danger }}>{mutationError}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button type="button" style={button} disabled={busy} onClick={() => setAction(undefined)}>{tr('取消')}</button><button type="button" style={{ ...button, color: action.kind === 'delete' ? theme.danger : theme.text }} disabled={busy} onClick={() => { void mutate() }}>{tr(busy ? '处理中…' : action.kind === 'delete' ? '确认删除' : '保存')}</button></div>
    </dialog>}
  </section>
}
