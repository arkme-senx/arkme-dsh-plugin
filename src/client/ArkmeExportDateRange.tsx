import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown';
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft';
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight';
import { tr } from './locale.js';
import { recordExportDatePreset, type RecordExportDates } from './record-export-selection.js';
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function ArkmeExportDateRange({ value, disabled, onChange }: {
    value: RecordExportDates;
    disabled: boolean;
    onChange(value: RecordExportDates): void;
}) {
    const id = useId(), anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false), [draft, setDraft] = useState(value), [choosingEnd, setChoosingEnd] = useState(false), [month, setMonth] = useState(() => new Date(value.start + 'T12:00:00')), [position, setPosition] = useState({ left: 0, top: 0 });
    useEffect(() => {
        if (!open)
            return;
        const place = () => {
            const rect = anchor.current?.getBoundingClientRect();
            if (rect)
                setPosition({ left: Math.max(8, Math.min(window.innerWidth - 316, rect.right - 308)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 390)) });
        };
        place();
        const down = (event: PointerEvent) => {
            if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.current?.contains(event.target))
                setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
                anchor.current?.focus();
            }
        };
        document.addEventListener('pointerdown', down, true);
        document.addEventListener('keydown', escape, true);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [open]);
    useEffect(() => {
        if (disabled)
            setOpen(false);
    }, [disabled]);
    const first = new Date(month.getFullYear(), month.getMonth(), 1), start = new Date(first);
    start.setDate(1 - first.getDay());
    return <><button ref={anchor} type="button" className="arkme-export-date-trigger" aria-label={tr('选择导出日期')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => { setDraft(value); setChoosingEnd(false); setMonth(new Date(value.start + 'T12:00:00')); setOpen(v => !v); }}>{value.start} — {value.end}<CaretDown size={14} aria-hidden/></button>
 {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={tr('导出日期范围')} className="arkme-export-calendar" style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 2147483000 }}>
 <header><button type="button" aria-label={tr('上个月')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><CaretLeft size={16}/></button><strong>{month.getFullYear()} / {month.getMonth() + 1}</strong><button type="button" aria-label={tr('下个月')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><CaretRight size={16}/></button></header>
 <div className="arkme-export-calendar-grid">{['日', '一', '二', '三', '四', '五', '六'].map(day => <span key={day}>{tr(day)}</span>)}{Array.from({ length: 42 }, (_, index) => {
                const date = new Date(start);
                date.setDate(start.getDate() + index);
                const value = key(date), selected = value === draft.start || value === draft.end;
                return <button type="button" key={value} aria-label={value} aria-pressed={selected} data-outside={date.getMonth() !== month.getMonth()} data-between={value > draft.start && value < draft.end} className={selected ? 'is-selected' : ''} onClick={() => {
                        if (!choosingEnd) {
                            setDraft({ start: value, end: value });
                            setChoosingEnd(true);
                        }
                        else {
                            setDraft({ start: value < draft.start ? value : draft.start, end: value < draft.start ? draft.start : value });
                            setChoosingEnd(false);
                        }
                    }}>{date.getDate()}</button>;
            })}</div>
 <div className="arkme-export-presets">{([['week', '最近7天'], ['month', '本月'], ['last-month', '上月']] as const).map(([preset, label]) => <button type="button" key={preset} onClick={() => { const dates = recordExportDatePreset(preset); setDraft(dates); setMonth(new Date(dates.start + 'T12:00:00')); setChoosingEnd(false); }}>{tr(label)}</button>)}</div>
 <footer><small>{draft.start} — {draft.end}</small><button type="button" onClick={() => { onChange(draft); setOpen(false); anchor.current?.focus(); }}>{tr('确定')}</button></footer></div>, document.body)}</>;
}
