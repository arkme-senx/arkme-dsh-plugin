import { tr, useArkmeLocale, arkmeIntlLocale } from '../locale.js'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import type { PreparedRecordingComparison } from './prepare-recording-transcript-comparison.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'
import { useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingComparison, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeTheme as colors } from '../arkme-theme.js'
import { useRecordingPlayback } from './useRecordingPlayback.js'
import { refreshRecordingTranscriptPage } from '../../recording-transcript-page.js'
import { useRecordingTranscriptPages } from './useRecordingTranscriptPages.js'
import { RecordingComparisonView, RecordingComparisonColumn, RecordingComparisonPane, RecordingComparisonRow, useRecordingComparisonScroll } from './RecordingComparisonView.js'

export function RecordingTranscriptComparison({ dateStamp, mediaPath, prepared, onClose }: {
  dateStamp: number
  mediaPath: string
  prepared: PreparedRecordingComparison
  onClose(): void
}) {
  useArkmeLocale()
  const [data, setData] = useState<ArkmeRecordingComparison>(prepared.data)
  const [error, setError] = useState('')
  const [playbackNotice, setPlaybackNotice] = useState('')
  const [pending, setPending] = useState(prepared.pending)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(prepared.notice)
  const submission = useRef<AbortController>()
  useEffect(() => () => submission.current?.abort(), [])
  const [revision, setRevision] = useState(0)
  const { columns, synchronize } = useRecordingComparisonScroll()
  const primaryPages = useRecordingTranscriptPages(data.system, String(dateStamp), page => setData(current => ({ ...current, system: page })))
  const enhancedPages = useRecordingTranscriptPages(data.doubao, String(dateStamp), page => setData(current => ({ ...current, doubao: page })))
  const player = useRecordingPlayback(mediaPath, async (last, signal) => {
    const pages = last.transcriptSource === 'system' ? primaryPages : enhancedPages
    return (await pages.through(last.startAtMillis, signal))?.items ?? []
  })
  useEffect(() => { player.stop() }, [data.system.viewRef, data.doubao.viewRef, player.stop])

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

  const startEnhancement = async () => {
    if (submission.current || pending) return
    const controller = new AbortController(); submission.current = controller
    setSubmitting(true); setError(''); setNotice('')
    try {
      const result = await callArkme<{ queuedCount: number; inFlightCount: number; missingAudioCount: number }>('recordings.compare.start', { dateStamp }, controller.signal)
      if (controller.signal.aborted) return
      const accepted = result.queuedCount + result.inFlightCount > 0
      const warning = result.missingAudioCount > 0 ? '部分录音没有可用于豆包转写的音频' : ''
      if (!accepted) { setNotice(warning || '没有新增可处理的音频'); return }
      setPending(true); setNotice(warning); setRevision(value => value + 1)
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '豆包转写提交失败') }
    finally { if (submission.current === controller) { submission.current = undefined; if (!controller.signal.aborted) setSubmitting(false) } }
  }

  const play = (item: ArkmeRecordingWorkbenchItem) => {
    setPlaybackNotice('')
    const section = item.transcriptSource === 'system' ? data.system : data.doubao
    void player.playAt(section.items, item.startAtMillis)
  }

  return <RecordingComparisonView scope={`当天录音 · ${new Date(dateStamp).toLocaleDateString(arkmeIntlLocale())}`} onClose={onClose}
    description={<span>豆包对比覆盖当天录音，正式结果不变。</span>}
    notices={<>
      {error && <div role="alert" style={{ color: colors.danger, padding: '8px 20px' }}>{error}<RecordingTranscriptButton onClick={() => { setRevision(value => value + 1) }} disabled={loading}>{tr('重试')}</RecordingTranscriptButton></div>}
      {(playbackNotice || player.error) && <div role="alert" style={{ color: colors.danger, padding: '8px 20px' }}>{playbackNotice || player.error}</div>}
      {notice !== '' && <div role="status" style={{ color: colors.secondary, padding: '8px 20px' }}>{notice}</div>}
    </>}>
    {(['system', 'doubao'] as const).map((source, index) => <RecordingComparisonColumn key={source} title={source === 'system' ? '系统转写' : '豆包转写'} kind={source === 'system' ? '正式结果' : '对比结果'} actions={<>
      {player.isPlaying && data[source].items.some(item => item.itemRef === player.activeItemRef) && <RecordingTranscriptButton aria-label={tr('暂停播放')} onClick={player.pause} style={{ border: 0, width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}><Pause size={18} /></RecordingTranscriptButton>}
      {source === 'doubao' && !pending && data.candidateCount > 0 && <RecordingTranscriptButton disabled={submitting} onClick={() => { void startEnhancement() }}>{submitting ? '正在提交…' : '开始豆包转写'}</RecordingTranscriptButton>}
      {source === 'doubao' && pending && <small role="status" style={{ color: colors.secondary }}>{tr('豆包转写中…')}</small>}
    </>}>
      {source === 'doubao' && !pending && data.candidateCount > 0 && <p style={{ margin: '0 20px', fontSize: 12, color: colors.secondary }}>将处理当天尚未完成豆包转写的音频，正式结果不变。</p>}
      <RecordingComparisonPane paneRef={element => { columns.current[index] = element }} onScroll={event => { synchronize(event, index); const pane = event.currentTarget; const pages = source === 'system' ? primaryPages : enhancedPages; if (pages.error === '' && pane.scrollHeight - pane.scrollTop - pane.clientHeight < 400) void pages.next().catch(() => undefined) }}>
        {data[source].items.map(item => <RecordingComparisonRow key={item.itemId} speaker={item.speakerLabel} colorIndex={item.speakerColorIndex}
          startAtMillis={item.startAtMillis} endAtMillis={item.endAtMillis} text={item.text} background={item.isBackground}
          active={player.activeItemRef === item.itemRef && player.positionAtMillis !== undefined && player.positionAtMillis >= item.startAtMillis && player.positionAtMillis < item.endAtMillis}
          playLabel={`播放${source === 'system' ? '系统' : '豆包'}片段 ${new Date(item.startAtMillis).toLocaleTimeString(arkmeIntlLocale(), { hour12: false })}`} onPlay={() => play(item)} />)}
        {(source === 'system' ? primaryPages.error : enhancedPages.error) !== '' && <p role="alert">{source === 'system' ? primaryPages.error : enhancedPages.error}</p>}
        {data[source].nextCursor !== '' && <RecordingTranscriptButton disabled={source === 'system' ? primaryPages.loading : enhancedPages.loading} onClick={() => { void (source === 'system' ? primaryPages : enhancedPages).next().catch(() => undefined) }}>加载更多</RecordingTranscriptButton>}
        {data[source].items.length === 0 && <p style={{ color: colors.secondary }}>{pending && source === 'doubao' ? '正在转写，请稍候' : data[source].message || '暂无转写'}</p>}
        {source === 'doubao' && data.failedCount > 0 && <p role="status" style={{ color: colors.danger }}>{data.failedCount} {tr('个片段转写失败')}</p>}
        {source === 'doubao' && data.silentCount > 0 && <p role="status">{data.silentCount} {tr('个片段未识别到人声')}</p>}
      </RecordingComparisonPane>
    </RecordingComparisonColumn>)}
  </RecordingComparisonView>
}
