import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { callArkme } from '../api.js'
import { tr, arkmeIntlLocale } from '../locale.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import type { PublicRecordingImportCurrentSnapshot, PublicRecordingImportHistoryPage } from '../../recording-import-shared.js'
import { recordingImportEndTimeError, recordingImportLocalInputValue } from './ArkmeRecordingImportDialog.js'
import { mergeRecordingFiles, recordingFileDayBounds, recordingFileKey, recordingFileMatchesDay, recordingFileStatusLabel, type RecordingFile, type RecordingFileDateBasis } from './recording-day-files.js'

interface Props {
  accountKey: string | undefined
  dateStamp: number
  refreshRevision: number
  active: boolean
  onChanged(): void
  onImport(): void
}
type Action = { kind: 'delete' | 'start' | 'ownership'; file: RecordingFile }
const control: CSSProperties = { minHeight: 32, padding: '5px 10px', border: `1px solid ${theme.border}`, borderRadius: 7, background: theme.base, color: theme.text, font: 'inherit', fontSize: 12 }
const button: CSSProperties = { ...control, cursor: 'pointer' }
const note: CSSProperties = { color: theme.secondary, fontSize: 12, lineHeight: '20px' }
const cell: CSSProperties = { padding: '12px 8px', textAlign: 'left', verticalAlign: 'top', borderBottom: `1px solid ${theme.borderSoft}` }
const PAGE_SIZE = 50
const PAGES_PER_BATCH = 10

function instant(value: number) {
  return value > 0 ? new Date(value).toLocaleString(arkmeIntlLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
}
function duration(value: number) {
  const seconds = Math.floor(Math.max(0, value) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function size(value: number) {
  return value > 0 ? value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB` : '—'
}

/** Account-key remount isolates file actions and late responses across login changes. */
export function ArkmeRecordingFiles(props: Props) {
  return props.accountKey ? <RecordingFiles key={props.accountKey} {...props} /> : <p style={note}>{tr('登录后查看音频文件')}</p>
}

function RecordingFiles({ dateStamp, active, refreshRevision, onChanged, onImport }: Props) {
  const [basis, setBasis] = useState<RecordingFileDateBasis>('recorded')
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState<RecordingFile[]>([])
  const [history, setHistory] = useState<RecordingFile[]>([])
  const [currentWarning, setCurrentWarning] = useState('')
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
  const request = useRef<{ controller: AbortController; toMillis: number; offset: number; loading: boolean }>()
  const mutation = useRef<AbortController>()
  const dialog = useRef<HTMLDialogElement>(null)

  const loadHistory = async (context: NonNullable<typeof request.current>) => {
    if (context.loading || context.controller.signal.aborted) return
    context.loading = true; setLoading(true); setHistoryError('')
    try {
      for (let pageIndex = 0; pageIndex < PAGES_PER_BATCH; pageIndex++) {
        const page = await withArkmeReadDeadline(signal => callArkme<PublicRecordingImportHistoryPage>('recordings.import.history', {
          toMillis: context.toMillis, limit: PAGE_SIZE, offset: context.offset,
        }, signal), context.controller.signal)
        if (context.controller.signal.aborted) return
        if (page.hasMore && page.items.length === 0) throw new Error(tr('文件列表未能继续加载，请刷新重试'))
        context.offset += page.items.length
        setHistory(previous => mergeRecordingFiles(previous, page.items))
        setHasMore(page.hasMore)
        if (!page.hasMore) break
      }
    } catch (error) {
      if (!context.controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : tr('音频文件加载失败'))
    } finally {
      context.loading = false
      if (!context.controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!active) return
    const context = { controller: new AbortController(), toMillis: Date.now(), offset: 0, loading: false }
    request.current = context
    setCurrent([]); setHistory([]); setCurrentWarning(''); setCurrentLoading(true); setHasMore(true)
    void withArkmeReadDeadline(signal => callArkme<PublicRecordingImportCurrentSnapshot>('recordings.import.list', {}, signal), context.controller.signal)
      .then(snapshot => {
        if (context.controller.signal.aborted) return
        setCurrent(snapshot.items)
        setCurrentWarning(snapshot.owner.state === 'unavailable' ? tr('部分未完成文件暂未同步，请稍后刷新')
          : snapshot.items.length >= 20 ? tr('未完成文件较多，当前仅显示最近任务') : '')
      }).catch(() => { if (!context.controller.signal.aborted) setCurrentWarning(tr('未完成文件加载失败，请刷新重试')) })
      .finally(() => { if (!context.controller.signal.aborted) setCurrentLoading(false) })
    void loadHistory(context)
    return () => { context.controller.abort() }
  }, [active, revision, refreshRevision])
  useEffect(() => () => { mutation.current?.abort() }, [])
  useEffect(() => { setMenu(undefined); if (!busy) { setAction(undefined); setMutationError('') } }, [dateStamp, basis])
  useEffect(() => { setMenu(undefined) }, [query])
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
  // Import completion, explicit refresh and successful edits reload this view.
  const files = useMemo(() => mergeRecordingFiles(history, current)
    .filter(file => recordingFileMatchesDay(file, dateStamp, basis) && file.fileName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => basis === 'recorded' ? a.startAtMillis - b.startAtMillis || recordingFileKey(a).localeCompare(recordingFileKey(b)) : b.createdAtMillis - a.createdAtMillis), [history, current, dateStamp, basis, query])
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
      setAction(undefined); setNotice(tr(kind === 'delete' ? '文件已删除' : '文件信息已更新'))
      setRevision(value => value + 1); onChanged()
    } catch (error) {
      if (!controller.signal.aborted) setMutationError(error instanceof Error ? error.message : tr('文件操作失败，请重试'))
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const { from, to } = recordingFileDayBounds(dateStamp)
  const complete = !loading && !currentLoading && !hasMore && !historyError && !currentWarning

  return <section aria-label={tr('音频文件')} style={{ minWidth: 0, fontSize: 13 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <select aria-label={tr('音频文件日期范围')} value={basis} onChange={event => setBasis(event.target.value as RecordingFileDateBasis)} style={control}>
        <option value="recorded">{tr('当天录音')}</option><option value="uploaded">{tr('当天上传')}</option><option value="all">{tr('全部文件')}</option>
      </select>
      <input type="search" aria-label={tr('搜索音频文件')} placeholder={tr('搜索文件名')} value={query} onChange={event => setQuery(event.target.value)} style={{ ...control, flex: 1, minWidth: 130 }} />
      <button type="button" style={button} disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>{tr('刷新')}</button>
      <button type="button" style={button} onClick={onImport}>{tr('上传音频')}</button>
    </div>
    <div style={{ ...note, marginBottom: 10 }}>{basis === 'all' ? tr('全部日期') : new Date(dateStamp).toLocaleDateString(arkmeIntlLocale())} · {tr(complete ? '共 {v0} 个文件' : '已找到 {v0} 个文件', { v0: String(files.length) })}
      {basis === 'uploaded' && <div>{tr('已上传文件按进入云端的时间筛选，不是上传完成时间；本机待上传文件按添加时间。')}</div>}
    </div>
    {notice && <p role="status" style={note}>{notice}</p>}
    {currentWarning && <p role="status" style={note}>{currentWarning}</p>}
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
      <thead><tr>{['文件名称 / 录音时间', '时长 / 大小', '归属', '状态', '操作'].map(label => <th key={label} style={{ ...cell, ...note, fontWeight: 500 }}>{tr(label)}</th>)}</tr></thead>
      <tbody>{files.map(file => <tr key={recordingFileKey(file)}>
        <td style={{ ...cell, maxWidth: 300 }}><div style={{ overflowWrap: 'anywhere', marginBottom: 4 }}>{file.fileName}</div><div style={note}>{instant(file.startAtMillis)} — {instant(file.endAtMillis)}</div>
          {(file.startAtMillis < from || file.endAtMillis > to) && basis === 'recorded' && <small style={note}>{tr('跨日文件，显示完整录音范围')}</small>}
          {basis === 'uploaded' && <div style={note}>{tr('importRef' in file ? '添加时间' : '进入云端')} {instant(file.createdAtMillis)}</div>}
        </td>
        <td style={{ ...cell, whiteSpace: 'nowrap' }}>{duration(file.durationMillis)}<div style={note}>{size(file.fileSize)}</div></td>
        <td style={cell}>{tr(file.ownership === 'self' ? '我的' : '他人')}</td>
        <td style={cell}><span title={file.statusDetail}>{tr(recordingFileStatusLabel(file))}</span></td>
        <td style={cell}><button type="button" aria-haspopup="menu" aria-expanded={menu?.file === file} aria-label={tr('管理 {v0}', { v0: file.fileName })} disabled={busy} style={{ ...button, padding: 2, border: 0 }} onClick={event => {
          if (menu?.file === file) { setMenu(undefined); return }
          const anchor = event.currentTarget, rect = anchor.getBoundingClientRect()
          setMenu({ file, anchor, left: Math.max(8, Math.min(rect.right - 168, window.innerWidth - 176)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 128)) })
        }}><DotsThree size={24} /></button></td>
      </tr>)}</tbody>
    </table></div>
    {files.length === 0 && <p style={{ ...note, padding: '24px 0', textAlign: 'center' }}>{tr(complete ? query ? '没有匹配的音频文件' : '当前范围没有音频文件' : '暂未找到匹配文件，列表尚未查全')}</p>}
    {(loading || currentLoading) && <p role="status" style={note}>{tr('正在查找音频文件…')}</p>}
    {historyError && <p role="alert" style={{ ...note, color: theme.danger }}>{historyError}</p>}
    {!loading && (hasMore || historyError) && <button type="button" style={button} onClick={() => { if (request.current) void loadHistory(request.current) }}>{tr(historyError ? '重试加载' : '继续查找更早文件')}</button>}
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
