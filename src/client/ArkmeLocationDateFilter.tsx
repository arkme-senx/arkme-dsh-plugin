import { useEffect, useRef, useState } from 'react'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { tr } from './locale.js'

export function ArkmeLocationDateFilter({ date, lastDate, onChange }: {
  date: string; lastDate: string; onChange(value: string): void
}) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(date)
  const apply = () => { if (draft) { onChange(draft); setOpen(false); trigger.current?.focus() } }
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <div className="arkme-location-date-control" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
    }
  }}>
    <button ref={trigger} className="arkme-location-filter-trigger" type="button" aria-label={tr('筛选位置日期')}
      aria-expanded={open} onClick={() => { setDraft(date); setOpen(value => !value) }}>
      <CalendarBlank size={16} aria-hidden/><span>{date || tr('全部日期')}</span><CaretDown size={12} aria-hidden/>
    </button>
    {open && <div className="arkme-location-date-menu" role="group" aria-label={tr('位置日期筛选')}>
      <label>{tr('日期')} <input type="date" aria-label={tr('位置日期')} value={draft}
        onChange={event => setDraft(event.currentTarget.value)} onInput={event => setDraft(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply() } }}/></label>
      <button type="button" disabled={!draft} onClick={apply}>{tr('查看位置')}</button>
      {date ? <><button type="button" onClick={() => onChange('')}>{tr('查看所有位置')}</button><small>{tr('当前日期显示个人记录的设备位置')}</small></>
        : lastDate && <button type="button" onClick={() => onChange(lastDate)}>{tr('返回 {date}', { date: lastDate })}</button>}
    </div>}
  </div>
}
