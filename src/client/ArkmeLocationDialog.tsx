import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeRecordLocationObservation, ArkmeSearchRecordItem, ArkmeTimelineItem } from '../types.js'
import type { LocationDateFilter } from './day-location-cache.js'
import { X } from '@phosphor-icons/react/dist/icons/X'
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

/** Shared full-map dialog for Explore and the personal calendar. */
export function ArkmeLocationDialog({ initialDate, initialLocation, onClose, returnFocusRef }: {
  initialDate?: LocationDateFilter; initialLocation?: ArkmeRecordLocationObservation; onClose(): void; returnFocusRef?: RefObject<HTMLElement>
}) {
  useArkmeLocale()
  const root = useRef<HTMLElement>(null)
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const hardRevision = useSyncExternalStore(locationSearchCache.subscribe, locationSearchCache.getHardRevision, locationSearchCache.getHardRevision)
  const detailRequest = useRef<AbortController>()
  const [detail, setDetail] = useState<{ source: ArkmeSearchRecordItem; value?: ArkmeTimelineItem; error?: string }>()
  const [original, setOriginal] = useState(false)
  const closeDetail = () => {
    detailRequest.current?.abort(); setDetail(undefined)
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.arkme-location-records')?.focus({ preventScroll: true }))
  }
  useEffect(() => {
    const previous = returnFocusRef?.current ?? document.activeElement
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
    <section ref={root} className="arkme-day-map-dialog" style={{ background: arkmeTheme.base, color: arkmeTheme.text }} role="dialog" aria-modal="true" aria-label={tr(initialDate ? '当天位置' : '位置')} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (detail) closeDetail(); else onClose() }
        if (event.key === 'Tab') {
          const nodes = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]') ?? [])].filter(node => node.getClientRects().length > 0 && !node.closest('[inert]'))
          const first = nodes[0], last = nodes.at(-1)
          if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <button className="arkme-location-dialog-close" type="button" aria-label={tr(initialDate ? '关闭当天位置' : '关闭位置')} title={tr('关闭位置')} style={detail ? { display: 'none' } : undefined} onClick={onClose}><X size={20}/></button>
      <div className="arkme-location-dialog-body" {...(detail ? { inert: '' } : {})} aria-hidden={detail ? true : undefined}>
      <ArkmeLocationQuickView {...(initialDate ? { initialDate } : {})}
        {...(initialLocation ? { initialLocation } : {})} onOpenRecord={item => { void openRecord(item) }} />
      </div>
      {detail && <div className="arkme-day-map-detail" style={{ background: arkmeTheme.base }}>
        {detail.value ? <ArkmeTimelineDetailDrawer item={detail.value} canExtend={false} showOriginal={original} onToggleOriginal={() => setOriginal(value => !value)} onClose={closeDetail} />
          : <><button type="button" onClick={closeDetail}>{tr('返回位置')}</button><p role={detail.error ? 'alert' : 'status'}>{detail.error || tr('加载中…')}</p>
            {detail.error && <button type="button" onClick={() => { void openRecord(detail.source) }}>{tr('重试')}</button>}</>}
      </div>}
    </section>
  </div>
  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
