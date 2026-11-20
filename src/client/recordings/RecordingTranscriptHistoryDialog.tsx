import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import type { ArkmeRecordingTranscriptPage, ArkmeRecordingTranscriptVersionPage, ArkmeRecordingWindow, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { appendRecordingTranscriptPage } from '../../recording-transcript-page.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import { callArkme } from '../api.js'
import { arkmeTheme as colors } from '../arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'
import { buildTranscriptHistoryPeriods, type TranscriptHistoryVersion } from './transcript-history.js'

/** Fetch an entire immutable page sequence before making it a selectable version. */
export async function loadTranscriptHistoryPage(dateStamp: number, window: ArkmeRecordingWindow | undefined, versionRef: string, signal: AbortSignal) {
  const args = { dateStamp, source: 'system', ...(window ? { window } : {}), ...(versionRef ? { versionRef } : {}) }
  const read = async (cursor?: string) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await callArkme<ArkmeRecordingTranscriptPage>('recordings.transcript.page', { ...args, ...(cursor ? { cursor } : {}) }, signal)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!page.retainedSnapshot || (page.versionRef ?? '') !== versionRef || page.dateStamp !== dateStamp || page.transcriptSource !== 'system' || page.state === 'error') throw new Error(tr('转写版本不匹配，请重试'))
    return page
  }
  let page = await read()
  const seen = new Set<string>()
  while (page.nextCursor) {
    if (seen.has(page.nextCursor)) throw new Error(tr('转写分页重复，请重试'))
    seen.add(page.nextCursor)
    page = appendRecordingTranscriptPage(page, await read(page.nextCursor))
  }
  if (page.items.some(item => item.textStartOffset !== 0 || item.textEndOffset !== item.textTotalLength)) throw new Error(tr('录音正文尚未读取完整'))
  return page
}

export function RecordingTranscriptHistoryDialog({ dateStamp, window, versions, timeZone, renderItem, onClose }: {
  dateStamp: number; window?: ArkmeRecordingWindow | undefined; versions: ArkmeRecordingTranscriptVersionPage
  timeZone?: string | undefined; renderItem(item: ArkmeRecordingWorkbenchItem): ReactNode; onClose(): void
}) {
  useArkmeLocale()
  // This viewer pins its input on mount; parent keys it by account/date scope.
  const [input] = useState({ dateStamp, window, versions })
  const cache = useRef<{ current?: ArkmeRecordingTranscriptPage; list: ArkmeRecordingTranscriptVersionPage; history: TranscriptHistoryVersion[] }>({ list: input.versions, history: [] })
  const [data, setData] = useState<{ current: ArkmeRecordingWorkbenchItem[]; history: TranscriptHistoryVersion[] }>({ current: [], history: [] })
  const [limit, setLimit] = useState(10)
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [popover, setPopover] = useState<string>()
  const menu = useRef<HTMLDivElement>(null)
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  const closePopover = () => { if (popover) triggers.current.get(popover)?.focus(); setPopover(undefined) }
  useEffect(() => {
    if (!popover || typeof document === 'undefined') return
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !triggers.current.get(popover)?.contains(event.target as Node)) setPopover(undefined)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [popover])
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    setLoading(true); setError('')
    const load = async () => {
      const saved = cache.current
      saved.current ??= await loadTranscriptHistoryPage(input.dateStamp, input.window, '', signal)
      while (saved.history.length < limit) {
        let version = saved.list.versions[saved.history.length]
        if (!version && saved.list.nextCursor) {
          const next = await callArkme<ArkmeRecordingTranscriptVersionPage>('recordings.transcript.versions', {
            dateStamp: input.dateStamp, source: 'system', ...(input.window ? { window: input.window } : {}), cursor: saved.list.nextCursor,
          }, signal)
          if (signal.aborted) return
          const unique = next.versions.filter(value => !saved.list.versions.some(old => old.versionRef === value.versionRef))
          if (next.nextCursor && (next.nextCursor === saved.list.nextCursor || !unique.length)) throw new Error(tr('转写分页重复，请重试'))
          saved.list = { ...next, versions: [...saved.list.versions, ...unique] }
          version = saved.list.versions[saved.history.length]
        }
        if (!version) break
        const page = await loadTranscriptHistoryPage(input.dateStamp, input.window, version.versionRef, signal)
        if (signal.aborted) return
        saved.history.push({ ...version, items: page.items })
      }
    }
    void load().catch(reason => {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : tr('读取转写历史版本失败'))
    }).finally(() => {
      if (signal.aborted) return
      const saved = cache.current
      setData({ current: saved.current?.items ?? [], history: [...saved.history] })
      setMore(saved.history.length < saved.list.versions.length || !!saved.list.nextCursor)
      setLoading(false)
    })
    return () => controller.abort()
  }, [input, limit, retry])
  const periods = useMemo(() => buildTranscriptHistoryPeriods(data.current, data.history), [data])
  const formatMinute = (value: number) => new Intl.DateTimeFormat(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).format(value)
  const versionLabel = (createdAt: number) => tr('{v0} 更新前', { v0: new Intl.DateTimeFormat(arkmeIntlLocale(), {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', ...(timeZone ? { timeZone } : {}),
  }).format(createdAt) })
  return <ArkmeConfirmDialog layout="picker" titleId="recording-history-title" title={tr('转写历史')} busy={false} onClose={onClose}
    dialogStyle={{ width: 'min(1180px, calc(100vw - 48px))', height: 'min(820px, calc(100dvh - 64px))', maxHeight: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
      <strong style={{ fontSize: 17 }}>{tr('转写历史')}</strong>
      <span style={{ color: colors.secondary, fontSize: 13, flex: 1 }}>{new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(dateStamp)}</span>
      <RecordingTranscriptButton aria-label={tr('关闭转写历史')} onClick={onClose} style={{ border: 0, padding: 4, display: 'grid', placeItems: 'center', background: 'transparent' }}><X size={20} /></RecordingTranscriptButton>
    </header>
    <div style={{ padding: '10px 20px', fontSize: 12, color: colors.secondary }}><span style={{ color: colors.danger }}>● </span>{tr('红色时段有历史版本，点击历史图标查看')}</div>
    <div className="arkme-recording-history" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '8px 20px 24px' }}>
      {periods.map(period => {
        const chosen = period.versions.find(version => version.versionRef === selection[period.id]) ?? period.versions[0]!
        const hasHistory = period.versions.length > 1
        const label = formatMinute(period.startAtMillis) + (period.endAtMillis - period.startAtMillis > 60_000 ? `–${formatMinute(period.endAtMillis)}` : '')
        return <section key={period.id} data-history-period={period.id} style={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: 12 }}>
          <div style={{ position: 'relative', borderLeft: `2px solid ${hasHistory ? colors.danger : colors.border}`, padding: '10px 0 28px 12px', color: hasHistory ? colors.danger : colors.secondary }}>
            <span aria-hidden style={{ position: 'absolute', width: 8, height: 8, borderRadius: '50%', left: -5, top: 18, background: hasHistory ? colors.danger : colors.tertiary }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}><time style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{label}</time>
              {hasHistory && <button ref={element => { if (element) triggers.current.set(period.id, element); else triggers.current.delete(period.id) }} type="button" data-history-period-trigger={period.id}
                aria-label={tr('查看 {v0} 的历史版本', { v0: label })} title={tr('历史')} aria-haspopup="menu" aria-expanded={popover === period.id}
                onClick={() => setPopover(popover === period.id ? undefined : period.id)}
                style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 4, display: 'grid', placeItems: 'center' }}><ClockCounterClockwise size={17} /></button>}
            </div>
            {chosen.versionRef && <small style={{ display: 'block', fontSize: 11, marginTop: 4 }}>{tr('历史版本')}</small>}
            {popover === period.id && <div ref={menu} role="menu" aria-label={tr('历史版本')} onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePopover() }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
              }
            }} style={{ position: 'absolute', left: 12, top: 42, zIndex: 10, width: 232, maxHeight: 240, overflowY: 'auto', padding: 5, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.elevated, boxShadow: '0 8px 30px rgba(0,0,0,.14)' }}>
              {period.versions.map(version => <button type="button" key={version.versionRef} role="menuitemradio" aria-checked={chosen.versionRef === version.versionRef} data-history-version={version.versionRef}
                onClick={() => { setSelection(value => ({ ...value, [period.id]: version.versionRef })); closePopover() }}
                style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: '9px 10px', border: 0, borderRadius: 6, background: chosen.versionRef === version.versionRef ? colors.active : 'transparent', color: colors.text, font: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ flex: 1 }}>{version.versionRef ? versionLabel(version.createdAtMillis) : tr('当前版本')}</span>{chosen.versionRef === version.versionRef && <Check size={14} />}
              </button>)}
            </div>}
          </div>
          <div style={{ minWidth: 0, paddingBottom: 18 }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>{chosen.items.map(item => renderItem(item))}</ul>
            {!chosen.items.length && <p style={{ fontSize: 13, color: colors.tertiary }}>{tr('该时段当前暂无转写')}</p>}
          </div>
        </section>
      })}
      {loading && <p role="status" style={{ color: colors.secondary }}>{tr('正在读取转写历史…')}</p>}
      {error && <div role="alert" style={{ color: colors.danger }}>{error} <RecordingTranscriptButton disabled={loading} onClick={() => setRetry(value => value + 1)}>{tr('重试')}</RecordingTranscriptButton></div>}
      {!loading && !error && !periods.length && <p>{tr('暂无转写内容')}</p>}
      {more && !error && <RecordingTranscriptButton disabled={loading} onClick={() => setLimit(value => value + 10)}>{tr('加载更早历史')}</RecordingTranscriptButton>}
    </div>
  </ArkmeConfirmDialog>
}
