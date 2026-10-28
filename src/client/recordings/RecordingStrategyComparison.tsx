import { useEffect, useRef, useState } from 'react'
import { callArkme } from '../api.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import type { RecordingStrategy, RecordingStrategyOptions, RecordingStrategyPage, RecordingStrategySources } from '../../recording-strategy-contract.js'

import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { useRecordingStrategyPlayback } from './useRecordingStrategyPlayback.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'
import { RecordingComparisonView, RecordingComparisonColumn, RecordingComparisonPane, RecordingComparisonRow } from './RecordingComparisonView.js'
const clock = (millis: number) => new Date(millis).toLocaleTimeString('zh-CN', { hour12: false })

/** Separate from Doubao enhancement: only the initial strategy is official. */
export function RecordingStrategyComparison({ sessionRef, initialSource, fileName, mediaPath, onClose }: {
  fileName: string; mediaPath: string; onClose(): void
} & ({ sessionRef: string; initialSource?: never } | { sessionRef?: never; initialSource: RecordingStrategySources["items"][number] })) {
  const [sources, setSources] = useState<RecordingStrategySources>({ items: [] })
  const [sourceRef, setSourceRef] = useState('')
  const [options, setOptions] = useState<RecordingStrategyOptions>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [sourceRevision, setSourceRevision] = useState(0)
  const [sourcesBusy, setSourcesBusy] = useState(false)
  const [sourcesLoaded, setSourcesLoaded] = useState(false)
  const stopPlayback = useRef<(() => void) | undefined>()
  const request = useRef<AbortController>()
  useEffect(() => {
    setError(''); setOptions(undefined); setSourcesLoaded(false); setSources({ items: [] }); setSourceRef('')
    const controller = new AbortController(); request.current = controller
    if (initialSource) {
      setSourcesLoaded(true); setSources({ items: [initialSource] }); setSourceRef(initialSource.sourceRef)
    } else void callArkme<RecordingStrategySources>('recordings.strategies', { action: 'sources', sessionRef }, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setSourcesLoaded(true); setSources(page); setSourceRef(page.items[0]?.sourceRef ?? '')
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败') })
    return () => { controller.abort(); stopPlayback.current?.() }
  }, [sessionRef, initialSource?.sourceRef, sourceRevision])
  useEffect(() => {
    if (!sourceRef) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setOptions(undefined); setError('')
    const load = async () => {
      try {
        const next = await callArkme<RecordingStrategyOptions>('recordings.strategies', { action: 'options', sourceRef }, controller.signal)
        if (controller.signal.aborted) return
        setOptions(next)
        if (!next.officialComplete || next.results.some(row => !row.complete)) timer = setTimeout(() => { void load() }, 3000)
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败') }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sourceRef, revision])
  useEffect(() => {
    if (!options?.canStart) return
    // Expiry is a display boundary even when no job is running. The server
    // remains authoritative for admission; existing transcript views stay open.
    const timer = setTimeout(() => setOptions(current => current ? { ...current, canStart: false } : current), Math.max(0, options.expiresAtMillis - Date.now()))
    return () => clearTimeout(timer)
  }, [sourceRef, options?.canStart, options?.expiresAtMillis])
  const start = async (strategy: RecordingStrategy) => {
    setBusy(true); setError('')
    try { await callArkme('recordings.strategies.start', { sourceRef, strategy }, request.current?.signal); setRevision(n => n + 1) }
    catch (e) { if (!request.current?.signal.aborted) setError(e instanceof Error ? e.message : '处理请求失败') }
    finally { setBusy(false) }
  }
  const moreSources = async () => {
    if (sourcesBusy) return
    setSourcesBusy(true)
    try {
      const page = await callArkme<RecordingStrategySources>('recordings.strategies', { action: 'sources', sessionRef, cursor: sources.nextCursor }, request.current?.signal)
      if (!request.current?.signal.aborted) setSources(current => ({ ...page, items: [...current.items, ...page.items] }))
    } catch (e) { if (!request.current?.signal.aborted) setError(e instanceof Error ? e.message : '加载失败') }
    finally { setSourcesBusy(false) }
  }
  const selectedName = sources.items.find(row => row.sourceRef === sourceRef)?.fileName || fileName
  const strategies = options ? [...options.strategies].sort((a, b) => Number(b.id === options.officialStrategy) - Number(a.id === options.officialStrategy)) : []
  return <RecordingComparisonView scope={`单个音频 · ${selectedName}`} onClose={onClose}
    description={<span>两列说话人编号各自独立；对比不改变正式结果。</span>}
    notices={<div style={{ padding: '0 20px', flex: 'none', fontSize: 12, color: theme.secondary }}>
      {sources.items.length > 1 && <select aria-label="选择音频源件" title={selectedName} value={sourceRef} onChange={e => setSourceRef(e.target.value)} style={{ maxWidth: '100%', width: 320, minWidth: 0, textOverflow: 'ellipsis', padding: '6px 8px', marginTop: 8, border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.base, color: theme.text }}>{sources.items.map(row => <option key={row.sourceRef} value={row.sourceRef}>{row.fileName || clock(row.startAtMillis)}</option>)}</select>}
      {sources.nextCursor && <RecordingTranscriptButton disabled={sourcesBusy} onClick={() => { void moreSources() }}>更多音频</RecordingTranscriptButton>}
      {error && <p role="alert" style={{ color: theme.danger }}>{error} <RecordingTranscriptButton onClick={() => sourceRef ? setRevision(n => n + 1) : setSourceRevision(n => n + 1)}>重试</RecordingTranscriptButton></p>}
      {!options && !error && <p role="status">{sourcesLoaded && sources.items.length === 0 ? '此录音暂无可对比的音频源件。' : '正在读取策略结果…'}</p>}
      {options && <p>{!options.officialComplete ? '请等待正式结果处理完成。' : options.officialFailed ? '正式处理未全部成功；请在录音文件中重试原任务。' : options.canStart ? `原件可用于其他策略处理，截止 ${new Date(options.expiresAtMillis).toLocaleString('zh-CN')}。` : '原件不可用于新的策略处理，已有结果仍可查看和播放。'}</p>}
    </div>}>
    {options && strategies.map(strategy => {
      const official = strategy.id === options.officialStrategy
      const result = options.results.find(row => row.strategy === strategy.id)
      const kind = official ? '正式结果' : '对比结果'
      return !official && !result ? <RecordingComparisonColumn key={strategy.id} title={strategy.name} kind={kind}
        actions={options.canStart && <RecordingTranscriptButton disabled={busy} onClick={() => { void start(strategy.id) }}>{busy ? '正在提交…' : '使用此策略处理'}</RecordingTranscriptButton>}>
        <RecordingComparisonPane><p style={{ color: theme.secondary }}>未生成此策略结果</p></RecordingComparisonPane>
      </RecordingComparisonColumn> : <StrategyTranscript key={`${sourceRef}:${strategy.id}:${official ? options.officialComplete : result?.complete ?? false}`}
        title={strategy.name} kind={kind}
        sourceRef={sourceRef} strategy={strategy.id} mediaPath={mediaPath} stopPlayback={stopPlayback}
        processing={official ? !options.officialComplete : !result?.complete} failed={official ? options.officialFailed : result?.failed ?? false} />
    })}
  </RecordingComparisonView>
}

function StrategyTranscript({ title, kind, sourceRef, strategy, mediaPath, stopPlayback, processing, failed }: { title: string; kind: '正式结果' | '对比结果'; sourceRef: string; strategy: RecordingStrategy; mediaPath: string; stopPlayback: React.MutableRefObject<(() => void) | undefined>; processing: boolean; failed: boolean }) {
  const [page, setPage] = useState<RecordingStrategyPage>({ items: [], complete: false, failed: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController>()
  const inFlight = useRef(false)
  const player = useRecordingStrategyPlayback(mediaPath, stopPlayback)
  const load = async (cursor?: string) => {
    if (inFlight.current) return
    inFlight.current = true
    const request = controller.current
    setBusy(true); setError('')
    try {
      const next = await callArkme<RecordingStrategyPage>('recordings.strategies', { action: 'page', sourceRef, strategy, ...(cursor ? { cursor } : {}) }, request?.signal)
      if (!request?.signal.aborted) setPage(prior => ({ ...next, ...(!next.nextCursor && !next.complete && cursor ? { nextCursor: cursor } : {}), items: cursor ? [...prior.items, ...next.items] : next.items }))
    } catch (e) { if (!request?.signal.aborted) setError(e instanceof Error ? e.message : '读取失败') }
    finally { if (controller.current === request) { inFlight.current = false; if (!request?.signal.aborted) setBusy(false) } }
  }
  useEffect(() => { controller.current = new AbortController(); inFlight.current = false; void load(); return () => { controller.current?.abort(); player.stop() } }, [sourceRef, strategy])
  return <RecordingComparisonColumn title={title} kind={kind} actions={<>
    {player.activeItemRef && <RecordingTranscriptButton aria-label="暂停播放" onClick={player.stop} style={{ border: 0, width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}><Pause size={18} /></RecordingTranscriptButton>}
  </>}>
    <RecordingComparisonPane pagination={{ cursor: page.nextCursor, loading: busy, error, next: () => load(page.nextCursor) }}>
      {player.error && <p role="alert" style={{ color: theme.danger }}>{player.error}</p>}
      {processing && <p role="status" style={{ color: theme.secondary, fontSize: 13, margin: '0 0 16px' }}>正在处理，完成后自动更新。</p>}
      {(failed || page.failed) && <p role="alert" style={{ color: theme.danger }}>此策略处理未全部成功，已完成部分保留。</p>}
      {page.items.map((item, index) => <RecordingComparisonRow key={`${item.itemRef}:${index}`} speaker={`说话人 ${item.speaker + 1}`} colorIndex={item.speaker}
        startAtMillis={item.startAtMillis} endAtMillis={item.endAtMillis} text={item.text} active={player.activeItemRef === item.itemRef}
        playLabel={`播放 ${clock(item.startAtMillis)} 的发言`} onPlay={() => { void player.play(item.itemRef) }} />)}
      {page.complete && page.items.length === 0 && <p style={{ color: theme.secondary }}>没有可展示的转写内容</p>}
    </RecordingComparisonPane>
  </RecordingComparisonColumn>
}
