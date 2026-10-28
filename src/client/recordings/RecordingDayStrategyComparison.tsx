import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { TextAlignLeft } from '@phosphor-icons/react/dist/icons/TextAlignLeft'
import { RECORDING_STRATEGIES, type RecordingStrategy } from '../../recording-strategy-contract.js'
import { callArkme } from '../api.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { canStartDayComparison, comparisonError, comparisonSourceState, readDayComparisonOptions, type DayComparisonSource } from './recording-comparison-day.js'
import { useRecordingDayComparisons } from './useRecordingDayComparisons.js'
import { useRecordingDayStrategyPages } from './useRecordingDayStrategyPages.js'
import { useRecordingStrategyPlayback } from './useRecordingStrategyPlayback.js'
import { RecordingComparisonView, RecordingComparisonColumn, RecordingComparisonPane, RecordingComparisonRow } from './RecordingComparisonView.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'
import { RecordingDayComparisonProgress } from './RecordingDayComparisonProgress.js'
import comparisonCss from './recording-day-comparison.css?inline'

const name = (strategy?: RecordingStrategy) => RECORDING_STRATEGIES.find(item => item.id === strategy)?.name ?? '策略暂未确认'
const clock = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })

/** A calendar comparison is a read view over all source-owned results, never a
 * replacement day result, merged speaker identity, or automatic reprocessing. */
export function RecordingDayStrategyComparison({ dateStamp, strategy, mediaPath, onClose }: {
  dateStamp: number; strategy: RecordingStrategy; mediaPath: string; onClose(): void
}) {
  const { sources, loading, error, refresh, reload } = useRecordingDayComparisons(dateStamp)
  const stopPlayback = useRef<(() => void) | undefined>()
  const submission = useRef<AbortController>()
  const [submitting, setSubmitting] = useState(false), [notice, setNotice] = useState('')
  useEffect(() => () => { submission.current?.abort(); stopPlayback.current?.() }, [])
  const candidates = sources.filter(source => canStartDayComparison(source, strategy))
  const start = async () => {
    if (submission.current) return
    const controller = new AbortController(); submission.current = controller
    setSubmitting(true); setNotice('')
    let accepted = 0, skipped = 0
    const failed: string[] = []
    try {
      // Use the existing idempotent source command. Recheck eligibility when
      // executing, since retention/deletion/another window may have advanced.
      for (const source of candidates) {
        controller.signal.throwIfAborted()
        try {
          const [fresh] = await readDayComparisonOptions([source], controller.signal)
          if (!fresh || fresh.error) throw new Error(fresh?.error || '策略信息读取失败')
          if (!canStartDayComparison(fresh, strategy)) { skipped++; continue }
          await callArkme('recordings.strategies.start', { sourceRef: source.sourceRef, strategy }, controller.signal)
          accepted++
        } catch (reason) { controller.signal.throwIfAborted(); failed.push(`${source.fileName || clock(source.startAtMillis)}：${comparisonError(reason)}`) }
      }
      await refresh()
      if (!controller.signal.aborted) setNotice([
        accepted ? `已提交 ${accepted} 个音频，仅处理未生成部分，已有结果直接复用。` : '没有新增处理任务。',
        skipped ? `${skipped} 个音频的处理条件已变化，未重复提交。` : '',
        failed.length ? `${failed.length} 个音频提交失败：${failed.join('；')}` : '',
      ].join(' '))
    } catch (reason) { if (!controller.signal.aborted) setNotice(comparisonError(reason)) }
    finally { if (submission.current === controller) { submission.current = undefined; if (!controller.signal.aborted) setSubmitting(false) } }
  }
  const officialNames = [...new Set(sources.flatMap(source => source.options ? [name(source.options.officialStrategy)] : []))]
  const metadataErrors = sources.filter(source => source.error)
  return <RecordingComparisonView scope={`当天全部录音 · ${new Date(dateStamp).toLocaleDateString('zh-CN')}`} onClose={onClose}
    description={<span>正式结果不变；不同音频、不同策略的说话人编号各自独立。</span>}
    notices={<><style>{comparisonCss}</style><div className="recording-day-overview">
      {loading && <p role="status">正在读取当天全部录音…</p>}
      {error && <p role="alert">{error} <RecordingTranscriptButton onClick={reload}>重试</RecordingTranscriptButton></p>}
      {!loading && !error && <p>{sources.length} 份录音{officialNames.length ? ` · 正式结果：${officialNames.join('、')}` : ''}</p>}
      {metadataErrors.length > 0 && <p role="alert">{metadataErrors.length} 个音频的策略信息读取失败，其他内容仍可查看。 <RecordingTranscriptButton disabled={submitting} onClick={() => { void refresh().catch(reason => setNotice(comparisonError(reason))) }}>重试</RecordingTranscriptButton></p>}
      {notice && <p role="status" className="recording-day-notice">{notice}<RecordingTranscriptButton aria-label="收起提交提示" onClick={() => setNotice('')}>收起</RecordingTranscriptButton></p>}
    </div></>}>
    {(['official', strategy] as const).map(selection => <DayTranscript key={selection} dateStamp={dateStamp} sources={sources}
      selection={selection} title={selection === 'official' ? '系统转写' : name(strategy)} kind={selection === 'official' ? '正式结果' : '对比结果'}
      mediaPath={mediaPath} stopPlayback={stopPlayback} loadingSources={loading || !!error}
      action={selection !== 'official' && candidates.length > 0 ? <RecordingTranscriptButton style={{ marginInlineStart: 'auto', background: theme.primaryAction, color: theme.onPrimaryAction }} disabled={submitting} onClick={() => { void start() }}>{submitting ? '正在提交…' : `处理当天未生成部分（${candidates.length}）`}</RecordingTranscriptButton> : undefined} />)}
  </RecordingComparisonView>
}

function DayTranscript({ sources, selection, title, kind, dateStamp, mediaPath, stopPlayback, loadingSources, action }: {
  sources: DayComparisonSource[]; selection: RecordingStrategy | 'official'; title: string; kind: '正式结果' | '对比结果'; dateStamp: number
  mediaPath: string; stopPlayback: MutableRefObject<(() => void) | undefined>
  loadingSources: boolean; action: React.ReactNode
}) {
  const { pages, pagination } = useRecordingDayStrategyPages(sources, selection, dateStamp)
  const player = useRecordingStrategyPlayback(mediaPath, stopPlayback)
  // Only actual text occupies the reading area. Status rows must not consume
  // viewport height and stop pagination before later files with real content.
  const visible = sources.filter(source => !!pages.get(source.sourceRef)?.items.length)
  const states = sources.map(source => comparisonSourceState(source, selection))
  const processing = states.some(state => state.processing)
  const failed = sources.some(source => source.error || pages.get(source.sourceRef)?.failed) || states.some(state => state.failed)
  const missing = states.some(state => !state.exists)
  const emptyTitle = !sources.length ? '当天暂无可对比的自有录音' : processing ? selection === 'official' ? '录音正在处理' : '对比结果正在生成' : failed ? '部分录音未能完成' : missing ? '尚未生成对比结果' : '已完成，当天没有可展示的转写内容'
  const emptyDescription = processing ? '已完成的内容会自动显示，无需再次提交。' : failed ? '可展开处理详情查看原因，已完成的内容会保留。' : missing ? action ? '使用上方按钮生成尚未处理的录音；已有结果不会重复处理。' : '可展开处理详情查看原件可用情况和未生成原因。' : '可以返回查看其他日期的录音。'
  return <RecordingComparisonColumn title={title} kind={kind} actions={<>{action}{player.activeItemRef && <RecordingTranscriptButton aria-label="暂停播放" onClick={player.stop}><Pause size={18} /></RecordingTranscriptButton>}</>}>
    <RecordingDayComparisonProgress sources={sources} selection={selection} pages={pages} />
    <RecordingComparisonPane pagination={pagination}>
      {player.error && <p role="alert" style={{ color: theme.danger }}>{player.error}</p>}
      {!loadingSources && !pagination.loading && !pagination.cursor && !pagination.error && visible.length === 0 && <div data-comparison-empty className="recording-day-empty">
        <TextAlignLeft size={30} aria-hidden style={{ opacity: .5 }} /><strong>{emptyTitle}</strong><p>{emptyDescription}</p>
      </div>}
      {visible.map(source => {
        const state = comparisonSourceState(source, selection), page = pages.get(source.sourceRef)
        return <div key={source.sourceRef} data-comparison-source className="recording-day-source">
          <div title={source.fileName} className="recording-day-source-heading">
            <span>{clock(source.startAtMillis)}{source.endAtMillis !== undefined && ` – ${clock(source.endAtMillis)}`}</span>
            <span>{name(state.strategy)} · {state.official ? '正式结果' : '对比结果'}</span>
          </div>
          {page?.items.map((item, index) => <RecordingComparisonRow key={`${item.itemRef}:${index}`} speaker={`说话人 ${item.speaker + 1}`} colorIndex={item.speaker}
            startAtMillis={item.startAtMillis} endAtMillis={item.endAtMillis} text={item.text} active={player.activeItemRef === item.itemRef}
            playLabel={`播放 ${clock(item.startAtMillis)} 的发言`} onPlay={() => { void player.play(item.itemRef) }} />)}
        </div>
      })}
    </RecordingComparisonPane>
  </RecordingComparisonColumn>
}
