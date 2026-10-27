import { useEffect, useRef, useState, type MutableRefObject, type Ref, type UIEvent } from 'react'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { RECORDING_STRATEGIES, type RecordingStrategy } from '../../recording-strategy-contract.js'
import { callArkme } from '../api.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { canStartDayComparison, comparisonError, comparisonSourceState, readDayComparisonOptions, type DayComparisonSource } from './recording-comparison-day.js'
import { useRecordingDayComparisons } from './useRecordingDayComparisons.js'
import { useRecordingDayStrategyPages } from './useRecordingDayStrategyPages.js'
import { useRecordingStrategyPlayback } from './useRecordingStrategyPlayback.js'
import { RecordingComparisonView, RecordingComparisonColumn, RecordingComparisonPane, RecordingComparisonRow, useRecordingComparisonScroll } from './RecordingComparisonView.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'

const name = (strategy?: RecordingStrategy) => RECORDING_STRATEGIES.find(item => item.id === strategy)?.name ?? '策略暂未确认'
const clock = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })

/** A calendar comparison is a read view over all source-owned results, never a
 * replacement day result, merged speaker identity, or automatic reprocessing. */
export function RecordingDayStrategyComparison({ dateStamp, strategy, mediaPath, onClose }: {
  dateStamp: number; strategy: RecordingStrategy; mediaPath: string; onClose(): void
}) {
  const { sources, loading, error, refresh, reload } = useRecordingDayComparisons(dateStamp)
  const { columns, synchronize } = useRecordingComparisonScroll()
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
        accepted ? `已提交 ${accepted} 个音频。` : '没有新增处理任务。',
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
    notices={<div style={{ padding: '0 20px', fontSize: 12, color: theme.secondary }}>
      {loading && <p role="status">正在读取当天全部录音…</p>}
      {error && <p role="alert">{error} <RecordingTranscriptButton onClick={reload}>重试</RecordingTranscriptButton></p>}
      {!loading && !error && <p>已找到 {sources.length} 个相关音频{officialNames.length ? ` · 正式结果使用：${officialNames.join('、')}` : ''}</p>}
      {metadataErrors.length > 0 && <p role="alert">{metadataErrors.length} 个音频的策略信息读取失败，其他内容仍可查看。 <RecordingTranscriptButton disabled={submitting} onClick={() => { void refresh().catch(reason => setNotice(comparisonError(reason))) }}>重试</RecordingTranscriptButton></p>}
      {notice && <p role="status" style={{ overflowWrap: 'anywhere' }}>{notice}</p>}
    </div>}>
    {(['official', strategy] as const).map((selection, index) => <DayTranscript key={selection} dateStamp={dateStamp} sources={sources}
      selection={selection} title={selection === 'official' ? '系统转写' : name(strategy)} kind={selection === 'official' ? '正式结果' : '对比结果'}
      mediaPath={mediaPath} stopPlayback={stopPlayback} loadingSources={loading || !!error}
      paneRef={element => { columns.current[index] = element }} onScroll={event => synchronize(event, index)}
      action={selection !== 'official' && candidates.length > 0 ? <RecordingTranscriptButton disabled={submitting} onClick={() => { void start() }}>{submitting ? '正在提交…' : `处理当天未生成部分（${candidates.length}）`}</RecordingTranscriptButton> : undefined} />)}
  </RecordingComparisonView>
}

function DayTranscript({ sources, selection, title, kind, dateStamp, mediaPath, stopPlayback, paneRef, onScroll, loadingSources, action }: {
  sources: DayComparisonSource[]; selection: RecordingStrategy | 'official'; title: string; kind: '正式结果' | '对比结果'; dateStamp: number
  mediaPath: string; stopPlayback: MutableRefObject<(() => void) | undefined>; paneRef: Ref<HTMLDivElement>; onScroll(event: UIEvent<HTMLDivElement>): void
  loadingSources: boolean; action: React.ReactNode
}) {
  const { pages, pagination } = useRecordingDayStrategyPages(sources, selection, dateStamp)
  const player = useRecordingStrategyPlayback(mediaPath, stopPlayback)
  // Do not render a day's worth of unloaded placeholders ahead of the reader:
  // they would fill the viewport and prevent its automatic continuation.
  const next = sources.findIndex(source => {
    const state = comparisonSourceState(source, selection)
    return state.exists && !source.error && !pages.has(source.sourceRef)
  })
  const visible = next < 0 ? sources : sources.slice(0, Math.max(next + 1, ...sources.map((source, index) => pages.has(source.sourceRef) ? index + 1 : 0)))
  return <RecordingComparisonColumn title={title} kind={kind} actions={<>{action}{player.activeItemRef && <RecordingTranscriptButton aria-label="暂停播放" onClick={player.stop}><Pause size={18} /></RecordingTranscriptButton>}</>}>
    <RecordingComparisonPane paneRef={paneRef} onScroll={onScroll} pagination={pagination}>
      {player.error && <p role="alert" style={{ color: theme.danger }}>{player.error}</p>}
      {!loadingSources && sources.length === 0 && <p style={{ color: theme.secondary }}>当天暂无可对比的自有录音。</p>}
      {visible.map(source => {
        const state = comparisonSourceState(source, selection), page = pages.get(source.sourceRef)
        return <div key={source.sourceRef} style={{ marginBottom: 20 }}>
          <div title={source.fileName} style={{ color: theme.secondary, fontSize: 12, display: 'flex', gap: 8, marginBottom: 10, minWidth: 0 }}>
            <span>{clock(source.startAtMillis)}</span><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.fileName || '录音'}</span>
            <span style={{ flexShrink: 0 }}>{name(state.strategy)} · {state.official ? '正式结果' : '对比结果'}</span>
          </div>
          {source.error && <p role="alert" style={{ color: theme.danger }}>{source.error}</p>}
          {!source.error && !state.exists && <p style={{ color: theme.secondary }}>{source.dayMembershipUnknown ? '录音时间范围尚未确认，暂不提交当天处理。' : !source.options?.officialComplete ? '正式录音仍在处理，完成后可生成对比。' : source.options.officialFailed ? '正式录音未处理成功，暂不可生成对比。' : canStartDayComparison(source, selection as RecordingStrategy) ? '尚未生成，可通过上方按钮处理。' : '未生成对比结果，原件当前不可用于新的处理。'}</p>}
          {state.processing && <p role="status" style={{ color: theme.secondary, fontSize: 12 }}>正在处理，完成后自动更新。</p>}
          {(state.failed || page?.failed) && <p role="alert" style={{ color: theme.danger }}>此音频处理未全部成功，已完成部分保留。</p>}
          {page?.items.map((item, index) => <RecordingComparisonRow key={`${item.itemRef}:${index}`} speaker={`说话人 ${item.speaker + 1}`} colorIndex={item.speaker}
            startAtMillis={item.startAtMillis} endAtMillis={item.endAtMillis} text={item.text} active={player.activeItemRef === item.itemRef}
            playLabel={`播放 ${clock(item.startAtMillis)} 的发言`} onPlay={() => { void player.play(item.itemRef) }} />)}
          {page?.done && page.items.length === 0 && <p style={{ color: theme.secondary }}>当前日期没有可展示的转写内容。</p>}
        </div>
      })}
    </RecordingComparisonPane>
  </RecordingComparisonColumn>
}
