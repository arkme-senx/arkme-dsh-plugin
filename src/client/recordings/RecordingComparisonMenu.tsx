import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { RECORDING_STRATEGIES, type RecordingStrategy } from '../../recording-strategy-contract.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { RecordingDesktopIcon } from './RecordingDesktopIcon.js'
import { RecordingDayStrategyComparison } from './RecordingDayStrategyComparison.js'

const control: CSSProperties = { padding: '7px 10px', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.text, background: theme.base, minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }
/** Opening this picker and choosing a result are read-only. Processing is explicit inside the result view. The calendar entry always views the entire selected day; processing remains source-owned;
 * Doubao remains the existing day-level enhancement, which can use playback audio. */
export function RecordingComparisonMenu({ dateStamp, disabled, busy, buttonStyle, mediaPath, onDoubao, onOpenResult }: {
  dateStamp: number; disabled: boolean; busy: boolean; buttonStyle?: CSSProperties | undefined; mediaPath: string; onDoubao(): void; onOpenResult(): void
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const [comparison, setComparison] = useState<RecordingStrategy>()
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
      <RecordingComparisonChoices dateStamp={dateStamp} onResult={strategy => { onOpenResult(); setComparison(strategy); close() }} onDoubao={() => { close(); onDoubao() }} />
    </div>, document.body)}
    {comparison && <RecordingDayStrategyComparison key={`${dateStamp}:${comparison}`} dateStamp={dateStamp} strategy={comparison} mediaPath={mediaPath} onClose={() => setComparison(undefined)} />}
  </>
}

export function RecordingComparisonChoices({ dateStamp, onResult, onDoubao }: { dateStamp: number; onResult(strategy: RecordingStrategy): void; onDoubao(): void }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
    <strong>转写对比</strong>
    <span style={{ fontSize: 12, color: theme.secondary }}>当天全部录音 · {new Date(dateStamp).toLocaleDateString('zh-CN')}</span>
    {RECORDING_STRATEGIES.map(strategy => <button key={strategy.id} type="button" onClick={() => onResult(strategy.id)} style={{ ...control, display: 'flex', gap: 12, justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer' }}>
      <span>{strategy.name}</span><span style={{ fontSize: 12, color: theme.secondary }}>查看当天对比</span>
    </button>)}
    <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 10 }}>
      <button type="button" style={{ ...control, width: '100%', display: 'flex', gap: 12, justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer' }} onClick={onDoubao}>
        <span>豆包</span><span style={{ fontSize: 12, color: theme.secondary }}>查看当天对比</span>
      </button>
    </div>
  </div>
}
