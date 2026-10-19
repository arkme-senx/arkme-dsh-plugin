import type { ReactNode } from 'react'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { tr } from '../locale.js'
import css from './offline-context-pending.css?inline'

/** The colleague's inline pending region, shared by the preview and live chat. */
export function OfflineContextPending({ count, hasMore = false, open, onToggle, children }: {
  count: number; hasMore?: boolean; open: boolean; onToggle(): void; children: ReactNode
}) {
  return <div className="arkme-offline-pending">
    <style>{css}</style>
    <button type="button" aria-expanded={open} onClick={onToggle}>
      <Waveform size={15} />{count}{hasMore ? '+' : ''} {tr('段线下交流待确认')} <span>{open ? tr('收起') : tr('查看')}</span>
    </button>
    {open && children}
  </div>
}
