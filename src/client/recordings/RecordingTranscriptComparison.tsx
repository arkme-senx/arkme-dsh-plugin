import { X } from '@phosphor-icons/react/dist/icons/X'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { recordingSpeakerColor } from './recording-speaker-presentation.js'
import type { PreparedRecordingComparison } from './prepare-recording-transcript-comparison.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'
import { useEffect, useRef, useState, type UIEvent } from 'react'
import type { ArkmeRecordingComparison, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeTheme as colors } from '../arkme-theme.js'
import { useRecordingPlayback } from './useRecordingPlayback.js'
import { refreshRecordingTranscriptPage } from '../../recording-transcript-page.js'
import { useRecordingTranscriptPages } from './useRecordingTranscriptPages.js'

export function RecordingTranscriptComparison({ dateStamp, mediaPath, prepared, onClose }: {
  dateStamp: number
  mediaPath: string
  prepared: PreparedRecordingComparison
  onClose(): void
}) {
  const [data, setData] = useState<ArkmeRecordingComparison>(prepared.data)
  const [error, setError] = useState('')
  const [playbackNotice, setPlaybackNotice] = useState('')
  const [pending, setPending] = useState(prepared.pending)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const columns = useRef<Array<HTMLDivElement | null>>([])
  const synchronizedScroll = useRef<{ element: HTMLDivElement; top: number }>()
  const primaryPages = useRecordingTranscriptPages(data.system, String(dateStamp), page => setData(current => ({ ...current, system: page })))
  const enhancedPages = useRecordingTranscriptPages(data.doubao, String(dateStamp), page => setData(current => ({ ...current, doubao: page })))
  const player = useRecordingPlayback(mediaPath, async (last, signal) => {
    const pages = last.transcriptSource === 'system' ? primaryPages : enhancedPages
    return (await pages.through(last.startAtMillis, signal))?.items ?? []
  })
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { player.stop() }, [data.system.viewRef, data.doubao.viewRef, player.stop])

  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      setLoading(true)
      try {
        const next = await callArkme<ArkmeRecordingComparison>('recordings.compare', { dateStamp }, controller.signal)
        if (controller.signal.aborted) return
        setData(current => ({ ...next, system: refreshRecordingTranscriptPage(current.system, next.system), doubao: refreshRecordingTranscriptPage(current.doubao, next.doubao) })); setError(''); setPending(next.doubao.processingCount > 0)
        if (next.doubao.processingCount > 0) timer = setTimeout(() => { void load() }, 3_000)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取转写失败')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    if (revision > 0) void load()
    else if (prepared.pending) timer = setTimeout(() => { void load() }, 3_000)
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [dateStamp, prepared, revision])

  const synchronize = (event: UIEvent<HTMLDivElement>, column: number) => {
    const element = event.currentTarget
    if (synchronizedScroll.current?.element === element && Math.abs(synchronizedScroll.current.top - element.scrollTop) < 2) return
    const top = element.getBoundingClientRect().top
    const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-transcript-time]'))
    const first = rows.find(row => row.getBoundingClientRect().bottom > top)
    const other = columns.current[1 - column]
    if (first === undefined || other == null) return
    const time = Number(first.dataset.transcriptTime)
    const candidates = Array.from(other.querySelectorAll<HTMLElement>('[data-transcript-time]'))
    const nearest = candidates.reduce<HTMLElement | undefined>((best, row) => best === undefined || Math.abs(Number(row.dataset.transcriptTime) - time) < Math.abs(Number(best.dataset.transcriptTime) - time) ? row : best, undefined)
    if (nearest === undefined) return
    const nextTop = Math.max(0, Math.min(other.scrollHeight - other.clientHeight, other.scrollTop + nearest.getBoundingClientRect().top - other.getBoundingClientRect().top))
    synchronizedScroll.current = { element: other, top: nextTop }
    other.scrollTop = nextTop
  }

  const play = (item: ArkmeRecordingWorkbenchItem) => {
    setPlaybackNotice('')
    const section = item.transcriptSource === 'system' ? data.system : data.doubao
    void player.playAt(section.items, item.startAtMillis)
  }

  return <div role="dialog" aria-modal="true" aria-label="转写对比" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'))
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
    }
  }} style={{ position: 'fixed', inset: 0, zIndex: 1_100, display: 'flex', flexDirection: 'column', background: colors.layer2, color: colors.text }}>
    <header style={{ height: 58, flex: 'none', padding: '0 20px', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${colors.border}` }}>
      <strong style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>转写对比</strong>
      <RecordingTranscriptButton ref={closeButton} onClick={onClose} aria-label="关闭转写对比" style={{ border: 0, padding: 4, display: 'grid', placeItems: 'center', background: 'transparent' }}><X size={20} /></RecordingTranscriptButton>
    </header>
    {error && <div role="alert" style={{ color: colors.danger, padding: '8px 20px' }}>{error}<RecordingTranscriptButton onClick={() => { setRevision(value => value + 1) }} disabled={loading}>重试</RecordingTranscriptButton></div>}
    {(playbackNotice || player.error) && <div role="alert" style={{ color: colors.danger, padding: '8px 20px' }}>{playbackNotice || player.error}</div>}
    {prepared.notice !== '' && <div role="status" style={{ color: colors.secondary, padding: '8px 20px' }}>{prepared.notice}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', flex: 1, minHeight: 0 }}>
      {(['system', 'doubao'] as const).map((source, index) => <section key={source} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderLeft: index === 1 ? `1px solid ${colors.border}` : undefined }}>
        <header style={{ height: 46, flex: 'none', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{source === 'system' ? '系统转写' : '豆包转写'}</h3>
          {source === 'system' && player.isPlaying && <RecordingTranscriptButton aria-label="暂停播放" onClick={player.pause} style={{ border: 0, width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}><Pause size={18} /></RecordingTranscriptButton>}
          {source === 'doubao' && pending && <small role="status" style={{ color: colors.secondary }}>豆包转写中…</small>}
        </header>
        <div ref={element => { columns.current[index] = element }} onScroll={event => { synchronize(event, index); const pane = event.currentTarget; const pages = source === 'system' ? primaryPages : enhancedPages; if (pages.error === '' && pane.scrollHeight - pane.scrollTop - pane.clientHeight < 400) void pages.next().catch(() => undefined) }} style={{ overflowY: 'auto', flex: 1, overscrollBehavior: 'contain', padding: '12px 20px 24px' }}>
          {data[source].items.map(item => {
            const active = player.positionAtMillis !== undefined && player.positionAtMillis >= item.startAtMillis && player.positionAtMillis < item.endAtMillis
            return <div role="button" tabIndex={0} aria-label={`播放${source === 'system' ? '系统' : '豆包'}片段 ${new Date(item.startAtMillis).toLocaleTimeString('zh-CN', { hour12: false })}`} key={item.itemId} data-transcript-time={item.startAtMillis} onDoubleClick={() => { play(item) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); play(item) } }} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6, padding: 4, borderRadius: 6, background: active ? colors.active : 'transparent', cursor: 'default', fontSize: 14, lineHeight: '22px' }}>
              <span style={{ display: 'flex', gap: 8, flex: 'none', alignItems: 'flex-start' }}><span aria-hidden style={{ width: 12, height: 12, marginTop: 5, borderRadius: '50%', background: recordingSpeakerColor(item.speakerColorIndex) }} /><span style={{ width: 78, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.speakerLabel}</span></span>
              {item.isBackground && <small style={{ flex: 'none', color: colors.secondary }}>背景音</small>}
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</span>
              <time style={{ flex: 'none', fontSize: 12, color: colors.secondary }}>{new Date(item.startAtMillis).toLocaleTimeString('zh-CN', { hour12: false })} {Math.max(0, Math.floor((item.endAtMillis - item.startAtMillis) / 1000))}秒</time>
            </div>
          })}
          {(source === 'system' ? primaryPages.error : enhancedPages.error) !== '' && <p role="alert">{source === 'system' ? primaryPages.error : enhancedPages.error}</p>}
          {data[source].nextCursor !== '' && <RecordingTranscriptButton disabled={source === 'system' ? primaryPages.loading : enhancedPages.loading} onClick={() => { void (source === 'system' ? primaryPages : enhancedPages).next().catch(() => undefined) }}>加载更多</RecordingTranscriptButton>}
          {data[source].items.length === 0 && <p style={{ color: colors.secondary }}>{pending && source === 'doubao' ? '正在转写，请稍候' : data[source].message || '暂无转写'}</p>}
          {source === 'doubao' && data.failedCount > 0 && <p role="status" style={{ color: colors.danger }}>{data.failedCount} 个片段转写失败</p>}
          {source === 'doubao' && data.silentCount > 0 && <p role="status">{data.silentCount} 个片段未识别到人声</p>}
        </div>
      </section>)}
    </div>
  </div>
}
