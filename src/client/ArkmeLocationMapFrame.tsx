import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { FunnelSimple } from '@phosphor-icons/react/dist/icons/FunnelSimple'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { locationSources, type LocationMarker, type LocationSource, type LocationViewport } from '../location-search.js'
import { ArkmeLocationSearchMap } from './ArkmeLocationSearchMap.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import css from './location-quick-view.css?inline'

const labels: Record<LocationSource, string> = { quick_note: '快记的位置', my_sent: '我发送的位置', received_private: '发给我的位置', received_group: '群聊中的位置' }
/** Shared presentation for all dates and the calendar's selected day. */
export function ArkmeLocationMapFrame(props: {
  account: string; browserAk: string; scope?: string; markers: LocationMarker[]; initialViewport: LocationViewport
  selectedKey?: string; onViewport(viewport: LocationViewport): void; onSelect(marker: LocationMarker): void
  sources: LocationSource[]; onSourcesChange(sources: LocationSource[]): void; availableSources?: readonly LocationSource[]
  summary: ReactNode; recordTitle?: string; recordCount?: number; children?: ReactNode
  onCloseRecords(): void; recordPanelRef?: RefObject<HTMLElement>; fitWhileLoading?: boolean
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filter = useRef<HTMLDivElement>(null), fallbackPanel = useRef<HTMLElement>(null)
  const panel = props.recordPanelRef ?? fallbackPanel
  const available = props.availableSources ?? locationSources
  useEffect(() => {
    if (!filtersOpen) return
    const close = (event: PointerEvent) => { if (!filter.current?.contains(event.target as Node)) setFiltersOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [filtersOpen])
  return <section className="arkme-location-view" aria-label={tr('位置快速查找')} style={{ color: arkmeTheme.text, background: arkmeTheme.base }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || (!filtersOpen && !props.selectedKey)) return
      event.preventDefault(); event.stopPropagation()
      if (filtersOpen) setFiltersOpen(false); else props.onCloseRecords()
    }}>
    <style>{css}</style>
    <div className="arkme-location-stage">
      <ArkmeLocationSearchMap account={props.account} browserAk={props.browserAk} markers={props.markers} initialViewport={props.initialViewport}
        {...(props.scope ? { scope: props.scope } : {})} {...(props.fitWhileLoading ? { fitWhileLoading: true } : {})}
        {...(props.selectedKey ? { selectedKey: props.selectedKey } : {})} onViewport={props.onViewport}
        onSelect={marker => { setFiltersOpen(false); props.onSelect(marker); requestAnimationFrame(() => panel.current?.focus({ preventScroll: true })) }} />
      <div className="arkme-location-filter-control" ref={filter}>
        <button className="arkme-location-filter-trigger" type="button" aria-label={tr('位置来源')} aria-expanded={filtersOpen}
          title={tr('筛选位置来源')} onClick={() => setFiltersOpen(value => !value)}>
          <FunnelSimple size={16} aria-hidden /><span>{tr('位置来源')}{props.sources.length !== available.length && ` · ${props.sources.length}/${available.length}`}</span><CaretDown size={12} aria-hidden />
        </button>
        {filtersOpen && <div className="arkme-location-filters" role="group" aria-label={tr('位置来源筛选')}>
          {available.map(source => <button key={source} type="button" data-arkme-feedback="neutral" aria-pressed={props.sources.includes(source)} onClick={() => {
            props.onSourcesChange(props.sources.includes(source) ? props.sources.filter(s => s !== source) : [...props.sources, source])
          }}><span className="arkme-location-dot" data-source={source} /><span>{tr(labels[source])}</span><span aria-hidden>{props.sources.includes(source) ? '✓' : ''}</span></button>)}
        </div>}
      </div>
      {!props.selectedKey && <div className="arkme-location-summary" role="status">{props.summary}</div>}
      {props.selectedKey && <aside className="arkme-location-records" aria-label={tr('该地点的记录')} tabIndex={-1} ref={panel}>
        <header><div><strong>{props.recordTitle || tr('该地点的记录')}</strong><small>{tr('{count} 条位置记录', { count: String(props.recordCount ?? 0) })}</small></div>
          <button type="button" aria-label={tr('关闭地点记录')} title={tr('关闭地点记录')} onClick={props.onCloseRecords}><X size={18} aria-hidden /></button></header>
        {props.children}
      </aside>}
    </div>
  </section>
}
