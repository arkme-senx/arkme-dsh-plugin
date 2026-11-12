import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { arkmeIntlLocale, tr } from './locale.js'

export function ArrangementTitleEditor({ title, disabled, onSave }: {
  title: string; disabled: boolean; onSave(title: string): Promise<boolean>
}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(title), [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null), saving = useRef(false), cancelled = useRef(false)
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select() } }, [editing])
  const save = async () => {
    if (saving.current || cancelled.current || disabled) return
    const next = draft.trim()
    if (!next || [...next].length > 200) { setError(tr('标题不能为空，最多200字')); return }
    if (next === title) { setEditing(false); setError(''); return }
    saving.current = true
    try { if (await onSave(next)) { setEditing(false); setError('') } }
    finally { saving.current = false }
  }
  if (!editing) return <button type="button" className="arkme-arrangement-title-edit" aria-label={tr('编辑标题')} title={tr('编辑标题')} disabled={disabled}
    onClick={() => { cancelled.current = false; setDraft(title); setError(''); setEditing(true) }}><PencilSimple size={16} aria-hidden /></button>
  return <div className="arkme-arrangement-title-editor">
    <input ref={input} aria-label={tr('安排标题')} value={draft} disabled={disabled} aria-invalid={!!error}
      onChange={event => setDraft(event.target.value)} onBlur={() => { void save() }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setEditing(false); setError('') }
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void save() }
      }} />
    {error && <small role="alert">{error}</small>}
  </div>
}

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const timeKey = (date: Date) => `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
export function ArrangementReminderTimeEditor({ at, disabled, onSave }: {
  at?: number | undefined; disabled: boolean; onSave(at: number): Promise<boolean>
}) {
  const [open, setOpen] = useState(false), [date, setDate] = useState(''), [time, setTime] = useState(''), [error, setError] = useState('')
  const [month, setMonth] = useState(() => new Date()), [position, setPosition] = useState({left:0,top:0})
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), saving = useRef(false)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect(); if (!rect) return
      setPosition({left:Math.max(12,Math.min(rect.right-304,window.innerWidth-316)),top:Math.max(12,Math.min(rect.bottom+8,window.innerHeight-400))})
    }
    place(); panel.current?.focus()
    window.addEventListener('resize',place); window.addEventListener('scroll',place,true)
    return () => { window.removeEventListener('resize',place); window.removeEventListener('scroll',place,true) }
  },[open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!saving.current && event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown',outside)
    return () => document.removeEventListener('pointerdown',outside)
  },[open])
  const save = async (day: string, clock: string) => {
    setError('')
    if (!day || !clock || disabled || saving.current) return
    const value = new Date(`${day}T${clock}:00`)
    if (!Number.isFinite(value.getTime()) || dateKey(value) !== day || timeKey(value) !== clock || value.getTime() <= Date.now()) {
      setError(tr('请选择有效的未来提醒时间')); return
    }
    if (value.getTime() === at) return
    saving.current = true
    try { if (!await onSave(value.getTime())) setError(tr('保存失败，请重新选择时间重试')) }
    finally { saving.current = false }
  }
  const first = new Date(month.getFullYear(),month.getMonth(),1)
  const start = new Date(first); start.setDate(1-(first.getDay()+6)%7)
  const days = Array.from({length:42},(_,i) => {const d=new Date(start);d.setDate(start.getDate()+i);return d})
  return <>
    <button ref={anchor} type="button" className="arkme-arrangement-time-edit" aria-label={tr('编辑提醒时间')} title={tr('编辑提醒时间')} aria-expanded={open} disabled={disabled}
      onClick={() => { if (open) {setOpen(false);return} const initial = new Date(at || Date.now());setDate(at ? dateKey(initial) : '');setTime(at ? timeKey(initial) : '09:00');setMonth(initial);setError('');setOpen(true) }}><PencilSimple size={16} aria-hidden /></button>
    {open && createPortal(<div ref={panel} role="dialog" aria-label={tr('编辑提醒时间')} tabIndex={-1} className="arkme-arrangement-time-popover" style={position}
      onKeyDown={event => { if (event.key==='Escape') {event.stopPropagation();setOpen(false);anchor.current?.focus()} }}>
      <header><button type="button" aria-label={tr('上个月')} onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><CaretLeft size={16} aria-hidden /></button>
        <strong>{new Intl.DateTimeFormat(arkmeIntlLocale(),{year:'numeric',month:'long'}).format(month)}</strong>
        <button type="button" aria-label={tr('下个月')} onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><CaretRight size={16} aria-hidden /></button></header>
      <div className="arkme-arrangement-date-grid">{Array.from({length:7},(_,i)=><small key={i}>{new Intl.DateTimeFormat(arkmeIntlLocale(),{weekday:'narrow'}).format(new Date(2026,10,9+i))}</small>)}
        {days.map(day=><button key={dateKey(day)} type="button" disabled={disabled} aria-label={dateKey(day)} aria-pressed={date===dateKey(day)} data-outside={day.getMonth()!==month.getMonth()}
          onClick={() => { const key=dateKey(day), clock=time || '09:00';setDate(key);setTime(clock);void save(key,clock) }}>{day.getDate()}</button>)}
      </div>
      <label>{tr('提醒时间')}<input type="time" aria-label={tr('提醒时刻')} value={time} disabled={disabled} onChange={event => {setTime(event.target.value);void save(date,event.target.value)}} /></label>
      {disabled && <small role="status">{tr('正在保存…')}</small>}
      {error && <p role="alert">{error}</p>}
    </div>,document.body)}
  </>
}
