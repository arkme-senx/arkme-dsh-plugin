import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeRecordLocationObservation, ArkmeSearchRecordItem, ArkmeTimelineItem } from '../types.js'
import type { DayActivityQuery } from './calendar-activity-model.js'
import { ArkmeLocationQuickView } from './ArkmeLocationQuickView.js'
import { ArkmeTimelineDetailDrawer } from './ArkmeNoteDetails.js'
import { arkmeAuthStore } from './auth-store.js'
import { locationSearchCache } from './location-search-cache.js'
import { arkmeUi } from './ui-controller.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
import css from './day-location-map.css?inline'

/** Calendar entry into the same location browser used by global search. */
export function ArkmeDayLocationMap({ query, initialLocation, onClose }: {
  query: DayActivityQuery; initialLocation?: ArkmeRecordLocationObservation; onClose(): void
}) {
  useArkmeLocale()
  const root = useRef<HTMLElement>(null)
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const hardRevision = useSyncExternalStore(locationSearchCache.subscribe, locationSearchCache.getHardRevision, locationSearchCache.getHardRevision)
  const detailRequest = useRef<AbortController>()
  const [detail, setDetail] = useState<{ source: ArkmeSearchRecordItem; value?: ArkmeTimelineItem; error?: string }>()
  const [original, setOriginal] = useState(false)
  const closeDetail = () => { detailRequest.current?.abort(); setDetail(undefined) }
  useEffect(() => {
    const previous = document.activeElement
    root.current?.focus()
    return () => { detailRequest.current?.abort(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => { closeDetail() }, [auth.auth?.userId, auth.auth?.environment, hardRevision])
  const openRecord = async (item: ArkmeSearchRecordItem) => {
    if (item.routeTargetKind !== 'record_detail' && item.targetSource) {
      onClose(); arkmeUi.showConversationTarget(item.targetSource, item.recordUid, item.sendAtMillis, item.recordOwnerUserId); return
    }
    detailRequest.current?.abort()
    const controller = new AbortController(); detailRequest.current = controller
    setDetail({ source: item }); setOriginal(false)
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<ArkmeTimelineItem>('record.app.detail', { recordUid: item.recordUid }, signal), controller.signal)
      if (!controller.signal.aborted) setDetail({ source: item, value })
    } catch (reason) { if (!controller.signal.aborted) setDetail({ source: item, error: reason instanceof Error ? reason.message : tr('读取失败，请重试') }) }
  }
  const body = <div className="arkme-day-map-backdrop" data-arkme-notification-blocking-overlay="true" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <style>{css}</style>
    <section ref={root} className="arkme-day-map-dialog" style={{ background: arkmeTheme.base, color: arkmeTheme.text }} role="dialog" aria-modal="true" aria-label={tr('当天位置')} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (detail) closeDetail(); else onClose() }
        if (event.key === 'Tab') {
          const nodes = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]') ?? [])].filter(node => node.getClientRects().length > 0)
          const first = nodes[0], last = nodes.at(-1)
          if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header className="arkme-day-map-heading"><h2>{tr('位置')}</h2><button type="button" aria-label={tr('关闭当天位置')} onClick={onClose}>×</button></header>
      <p className="arkme-day-scope">{tr('仅显示记录中保存的地点。')}</p>
      <ArkmeLocationQuickView initialDate={{ bucketDate: query.bucketDate, timezone: query.timezone }}
        {...(initialLocation ? { initialLocation } : {})} onOpenRecord={item => { void openRecord(item) }} />
      {detail && <div className="arkme-day-map-detail" style={{ background: arkmeTheme.base }}>
        {detail.value ? <ArkmeTimelineDetailDrawer item={detail.value} canExtend={false} showOriginal={original} onToggleOriginal={() => setOriginal(value => !value)} onClose={closeDetail} />
          : <><button type="button" onClick={closeDetail}>{tr('返回位置')}</button><p role={detail.error ? 'alert' : 'status'}>{detail.error || tr('加载中…')}</p>
            {detail.error && <button type="button" onClick={() => { void openRecord(detail.source) }}>{tr('重试')}</button>}</>}
      </div>}
    </section>
  </div>
  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
