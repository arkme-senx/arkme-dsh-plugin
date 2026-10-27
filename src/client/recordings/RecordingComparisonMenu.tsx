import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { RECORDING_STRATEGIES, type RecordingStrategy, type RecordingStrategyOptions, type RecordingStrategyRecordings, type RecordingStrategySources } from '../../recording-strategy-contract.js'
import { callArkme } from '../api.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { RecordingDesktopIcon } from './RecordingDesktopIcon.js'
import { RecordingStrategyComparison } from './RecordingStrategyComparison.js'

const control: CSSProperties = { padding: '7px 10px', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.text, background: theme.base, minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }
const select: CSSProperties = { ...control, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const field: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 5, fontSize: 12, color: theme.secondary }
const clock = (millis: number) => new Date(millis).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
const message = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
type Source = RecordingStrategySources['items'][number]

/** Opening this picker and choosing a result are read-only. Processing is explicit inside the result view. Full strategies operate on one source;
 * Doubao remains the existing day-level enhancement, which can use playback audio. */
export function RecordingComparisonMenu({ dateStamp, disabled, busy, buttonStyle, mediaPath, onDoubao, onOpenResult }: {
  dateStamp: number; disabled: boolean; busy: boolean; buttonStyle?: CSSProperties | undefined; mediaPath: string; onDoubao(): void; onOpenResult(): void
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const [comparison, setComparison] = useState<Source>()
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const leave = useRef<ReturnType<typeof setTimeout>>()
  const id = useId()
  const keyboardOpen = useRef(false)
  const cancelLeave = () => { clearTimeout(leave.current) }
  const close = () => { cancelLeave(); setOpen(false) }
  const enter = () => {
    cancelLeave()
    if (disabled) return
    const box = trigger.current?.getBoundingClientRect()
    if (box) setPosition({ left: Math.max(8, Math.min(box.right - 340, window.innerWidth - 348)), top: Math.min(box.bottom + 6, Math.max(8, window.innerHeight - 470)) })
    setOpen(true)
  }
  const scheduleClose = () => { cancelLeave(); leave.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement) && !panel.current?.querySelector('[aria-busy="true"]')) setOpen(false) }, 200) }
  useEffect(() => {
    if (!open) return
    if (keyboardOpen.current) { panel.current?.querySelector<HTMLElement>('select, button')?.focus(); keyboardOpen.current = false }
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close() }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    window.addEventListener('resize', close)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close) }
  }, [open])
  useEffect(() => { if (disabled) close() }, [disabled])
  useEffect(() => () => clearTimeout(leave.current), [])
  return <>
    <button ref={trigger} type="button" data-arkme-feedback="neutral" aria-label={busy ? '正在准备转写对比' : '转写对比'}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} style={buttonStyle} disabled={disabled}
      onMouseEnter={enter} onMouseLeave={scheduleClose} onClick={e => { keyboardOpen.current = e.detail === 0; enter() }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); keyboardOpen.current = true; enter() } }}>
      <RecordingDesktopIcon name="compare" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="选择转写对比" onMouseEnter={cancelLeave} onMouseLeave={scheduleClose}
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) close() }}
      style={{ position: 'fixed', ...position, zIndex: 1100, width: 'min(340px, calc(100vw - 16px))', maxHeight: 'min(460px, calc(100dvh - 16px))', overflowY: 'auto', boxSizing: 'border-box', padding: 14, border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.base, color: theme.text, boxShadow: '0 8px 32px #0002' }}>
      <RecordingComparisonChoices dateStamp={dateStamp} onResult={source => { onOpenResult(); setComparison(source); close() }} onDoubao={() => { close(); onDoubao() }} />
    </div>, document.body)}
    {comparison && <RecordingStrategyComparison key={comparison.sourceRef} initialSource={comparison} fileName={comparison.fileName || '录音'} mediaPath={mediaPath} onClose={() => setComparison(undefined)} />}
  </>
}

export function RecordingComparisonChoices({ dateStamp, onResult, onDoubao }: { dateStamp: number; onResult(source: Source): void; onDoubao(): void }) {
  const [recordings, setRecordings] = useState<RecordingStrategyRecordings>({ items: [] })
  const [sessionRef, setSessionRef] = useState('')
  const [sources, setSources] = useState<RecordingStrategySources>({ items: [] })
  const [source, setSource] = useState<Source>()
  const [options, setOptions] = useState<RecordingStrategyOptions>()
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const life = useRef<AbortController>(), sourceRequest = useRef<AbortController>()
  const end = new Date(dateStamp); end.setDate(end.getDate() + 1)
  const day = { action: 'recordings', startAtMillis: dateStamp, endAtMillis: end.getTime() }
  useEffect(() => {
    const controller = new AbortController(); life.current = controller
    setLoading(true); setError(''); setRecordings({ items: [] }); setSessionRef(''); setSource(undefined); setOptions(undefined)
    void callArkme<RecordingStrategyRecordings>('recordings.strategies', day, controller.signal).then(page => {
      if (!controller.signal.aborted) { setRecordings(page); setSessionRef(page.items[0]?.sessionRef ?? ''); setLoading(false) }
    }).catch(e => { if (!controller.signal.aborted) { setError(message(e)); setLoading(false) } })
    return () => controller.abort()
  }, [dateStamp, revision])
  useEffect(() => {
    setSources({ items: [] }); setSource(undefined); setOptions(undefined)
    if (!sessionRef) return
    const controller = new AbortController(); sourceRequest.current = controller
    setLoading(true); setError('')
    void callArkme<RecordingStrategySources>('recordings.strategies', { action: 'sources', sessionRef }, controller.signal).then(page => {
      if (!controller.signal.aborted) { setSources(page); setSource(page.items[0]); setLoading(false) }
    }).catch(e => { if (!controller.signal.aborted) { setError(message(e)); setLoading(false) } })
    return () => controller.abort()
  }, [sessionRef])
  useEffect(() => {
    setOptions(undefined)
    if (!source) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const value = await callArkme<RecordingStrategyOptions>('recordings.strategies', { action: 'options', sourceRef: source.sourceRef }, controller.signal)
        if (controller.signal.aborted) return
        setOptions(value)
        if (!value.officialComplete || value.results.some(row => !row.complete)) timer = setTimeout(() => { void load() }, 3000)
        else if (value.canStart) timer = setTimeout(() => setOptions(current => current ? { ...current, canStart: false } : current), Math.max(0, value.expiresAtMillis - Date.now()))
      } catch (e) { if (!controller.signal.aborted) setError(message(e)) }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [source?.sourceRef])
  const more = async (kind: 'recordings' | 'sources') => {
    if (busy) return
    const controller = kind === 'sources' ? sourceRequest.current : life.current
    setBusy(true); setError('')
    try {
      if (kind === 'recordings') {
        const page = await callArkme<RecordingStrategyRecordings>('recordings.strategies', { ...day, cursor: recordings.nextCursor }, controller?.signal)
        if (!controller?.signal.aborted) { setRecordings(current => ({ ...page, items: [...current.items, ...page.items] })); if (!sessionRef) setSessionRef(page.items[0]?.sessionRef ?? '') }
      } else {
        const page = await callArkme<RecordingStrategySources>('recordings.strategies', { action: 'sources', sessionRef, cursor: sources.nextCursor }, controller?.signal)
        if (!controller?.signal.aborted) { setSources(current => ({ ...page, items: [...current.items, ...page.items] })); if (!source) setSource(page.items[0]) }
      }
    } catch (e) { if (!controller?.signal.aborted) setError(message(e)) }
    finally { if (!controller?.signal.aborted) setBusy(false) }
  }
  const choose = (strategy: RecordingStrategy) => {
    if (!source || !options || busy) return
    const existing = strategy === options.officialStrategy || options.results.some(row => row.strategy === strategy)
    if (existing || (options.canStart && Date.now() < options.expiresAtMillis)) onResult(source)
  }
  const unavailable = !options ? '读取中' : !options.officialComplete ? '正式结果处理中' : options.officialFailed ? '正式处理失败' : '原件不可用'
  return <div aria-busy={busy} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, overflowWrap: 'anywhere' }}>
    <strong>转写对比</strong>
    {recordings.items.length > 0 && <label style={field}>录音时间
      <select aria-label="选择对比录音" disabled={busy} value={sessionRef} onChange={e => { setSessionRef(e.target.value); setSource(undefined); setOptions(undefined) }} style={select}>
        {recordings.items.map(row => <option key={row.sessionRef} value={row.sessionRef}>{clock(row.startAtMillis)}{row.endAtMillis > row.startAtMillis ? ` — ${clock(row.endAtMillis)}` : ''}</option>)}
      </select>
    </label>}
    {recordings.nextCursor && <button style={control} disabled={busy} onClick={() => { void more('recordings') }}>更多录音</button>}
    {sources.items.length > 0 && <label style={field}>音频文件
      <select aria-label="选择对比音频" title={source?.fileName} disabled={busy} value={source?.sourceRef ?? ''} onChange={e => { setSource(sources.items.find(row => row.sourceRef === e.target.value)); setOptions(undefined); setError('') }} style={select}>
        {sources.items.map((row, index) => <option key={row.sourceRef} value={row.sourceRef}>{row.fileName || `音频片段 ${index + 1}`}</option>)}
      </select>
    </label>}
    {sources.nextCursor && <button style={control} disabled={busy} onClick={() => { void more('sources') }}>更多音频</button>}
    <div style={{ fontSize: 12, color: theme.secondary }} role="status">{options ? `此音频正式结果：${RECORDING_STRATEGIES.find(row => row.id === options.officialStrategy)?.name}` : error ? '暂未读取到正式结果的策略' : loading || source ? '正在读取正式结果的策略…' : '当天暂无可对比的自有音频'}</div>
    {error && <div role="alert" style={{ fontSize: 12 }}>{error} <button style={control} onClick={() => setRevision(n => n + 1)}>重试</button></div>}
    {RECORDING_STRATEGIES.map(strategy => {
      const official = options?.officialStrategy === strategy.id
      const result = options?.results.find(row => row.strategy === strategy.id)
      const canOpen = !!options && (official || !!result || (options.canStart && Date.now() < options.expiresAtMillis))
      const status = official ? '正式结果' : result ? result.failed ? '查看部分结果' : result.complete ? '查看对比' : '处理中' : canOpen ? '未生成' : unavailable
      return <button key={strategy.id} type="button" disabled={busy || !canOpen} onClick={() => { void choose(strategy.id) }} style={{ ...control, display: 'flex', gap: 12, justifyContent: 'space-between', textAlign: 'left', cursor: canOpen ? 'pointer' : 'default', opacity: canOpen ? 1 : 0.55 }}>
        <span>{strategy.name}</span><span style={{ fontSize: 12, color: theme.secondary }}>{status}</span>
      </button>
    })}
    <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 10 }}>
      <button type="button" style={{ ...control, width: '100%', display: 'flex', gap: 12, justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer' }} disabled={busy} onClick={onDoubao}>
        <span>豆包</span><span style={{ fontSize: 12, color: theme.secondary }}>当天转写增强对比</span>
      </button>
    </div>
  </div>
}
