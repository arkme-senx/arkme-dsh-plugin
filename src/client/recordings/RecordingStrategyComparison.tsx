import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { callArkme } from '../api.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import type { RecordingStrategy, RecordingStrategyOptions, RecordingStrategyPage, RecordingStrategySources } from '../../recording-strategy-contract.js'

const button: CSSProperties = { padding: '6px 12px', border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.base, color: theme.text, cursor: 'pointer' }
const clock = (millis: number) => new Date(millis).toLocaleTimeString('zh-CN', { hour12: false })

/** Separate from Doubao enhancement: only the initial strategy is official. */
export function RecordingStrategyComparison({ sessionRef, fileName, mediaPath, onClose }: {
  sessionRef: string; fileName: string; mediaPath: string; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
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
    dialog.current?.showModal()
    setError(''); setOptions(undefined); setSourcesLoaded(false); setSources({ items: [] }); setSourceRef('')
    const controller = new AbortController(); request.current = controller
    void callArkme<RecordingStrategySources>('recordings.strategies', { action: 'sources', sessionRef }, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setSourcesLoaded(true); setSources(page); setSourceRef(page.items[0]?.sourceRef ?? '')
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败') })
    return () => { controller.abort(); stopPlayback.current?.(); dialog.current?.close() }
  }, [sessionRef, sourceRevision])
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
  return <dialog ref={dialog} aria-label="录音策略对比" onCancel={e => { e.preventDefault(); onClose() }} style={{ width: 'min(1200px, calc(100vw - 32px))', height: 'min(850px, calc(100dvh - 40px))', padding: 20, boxSizing: 'border-box', border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.text, background: theme.base }}>
    <div style={{ display: 'flex', gap: 16, justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>策略对比 · {fileName}</h3><button style={button} onClick={onClose}>关闭</button></div>
    <p style={{ fontSize: 13, color: theme.secondary }}>首次处理结果为正式结果。其他策略仅用于对比；两列的说话人编号各自独立，同号不表示同一个人。</p>
    {sources.items.length > 1 && <select aria-label="选择音频源件" value={sourceRef} onChange={e => setSourceRef(e.target.value)} style={button}>{sources.items.map(row => <option key={row.sourceRef} value={row.sourceRef}>{row.fileName || clock(row.startAtMillis)}</option>)}</select>}
    {sources.nextCursor && <button style={button} disabled={sourcesBusy} onClick={() => { void moreSources() }}>更多音频</button>}
    {error && <p role="alert">{error} <button style={button} onClick={() => sourceRef ? setRevision(n => n + 1) : setSourceRevision(n => n + 1)}>重试</button></p>}
    {!options && !error && <p role="status">{sourcesLoaded && sources.items.length === 0 ? '此录音暂无可对比的音频源件。' : '正在读取策略结果…'}</p>}
    {options && <>
      <p style={{ color: theme.secondary, fontSize: 12 }}>{!options.officialComplete ? '请等待正式结果处理完成。' : options.officialFailed ? '正式处理未全部成功；请在录音文件中重试原任务。' : options.canStart ? `原件可用于其他策略处理，截止 ${new Date(options.expiresAtMillis).toLocaleString('zh-CN')}。` : '原件不可用于新的策略处理，已有结果仍可查看和播放。'}</p>
      <div style={{ display: 'flex', gap: 16, height: 'calc(100% - 155px)', minHeight: 240, overflowX: 'auto' }}>
        {options.strategies.map(strategy => {
          const official = strategy.id === options.officialStrategy
          const result = options.results.find(row => row.strategy === strategy.id)
          return <section key={strategy.id} style={{ flex: '1 0 280px', minWidth: 0, display: 'flex', flexDirection: 'column', border: `1px solid ${theme.border}`, borderRadius: 8, padding: 12 }}>
            <h4 style={{ margin: '0 0 12px' }}>{strategy.name} {official ? '· 正式结果' : '· 对比结果'}</h4>
            {!official && !result ? options.canStart ? <button style={button} disabled={busy} onClick={() => { void start(strategy.id) }}>{busy ? '正在提交…' : '使用此策略处理'}</button> : <p>未生成此策略结果</p>
              : <StrategyTranscript key={`${sourceRef}:${strategy.id}:${official ? options.officialComplete : result?.complete ?? false}`} sourceRef={sourceRef} strategy={strategy.id} mediaPath={mediaPath} stopPlayback={stopPlayback} processing={official ? !options.officialComplete : !result?.complete} failed={official ? options.officialFailed : result?.failed ?? false} />}
          </section>
        })}
      </div>
    </>}
  </dialog>
}
function StrategyTranscript({ sourceRef, strategy, mediaPath, stopPlayback, processing, failed }: { sourceRef: string; strategy: RecordingStrategy; mediaPath: string; stopPlayback: React.MutableRefObject<(() => void) | undefined>; processing: boolean; failed: boolean }) {
  const [page, setPage] = useState<RecordingStrategyPage>({ items: [], complete: false, failed: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController>()
  const player = useRef<HTMLAudioElement>()
  const playRequest = useRef<AbortController>()
  const stop = () => { playRequest.current?.abort(); if (player.current) { player.current.pause(); player.current.removeAttribute('src'); player.current.load(); player.current = undefined } }
  const load = async (cursor?: string) => {
    setBusy(true); setError('')
    try {
      const next = await callArkme<RecordingStrategyPage>('recordings.strategies', { action: 'page', sourceRef, strategy, ...(cursor ? { cursor } : {}) }, controller.current?.signal)
      if (!controller.current?.signal.aborted) setPage(prior => ({ ...next, ...(!next.nextCursor && !next.complete && cursor ? { nextCursor: cursor } : {}), items: cursor ? [...prior.items, ...next.items] : next.items }))
    } catch (e) { if (!controller.current?.signal.aborted) setError(e instanceof Error ? e.message : '读取失败') }
    finally { setBusy(false) }
  }
  useEffect(() => { controller.current = new AbortController(); void load(); return () => { controller.current?.abort(); stop() } }, [sourceRef, strategy])
  const play = async (itemRef: string) => {
    stopPlayback.current?.(); stop(); stopPlayback.current = stop; const request = new AbortController(); playRequest.current = request
    try {
      const media = await callArkme<{ playbackRef: string }>('recordings.strategies', { action: 'playback', itemRef }, request.signal)
      if (request.signal.aborted) return
      const audio = new Audio(`${mediaPath}?ref=${encodeURIComponent(media.playbackRef)}`); player.current = audio
      audio.onerror = () => setError('播放失败，请重试')
      await audio.play()
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : '播放失败') }
  }
  return <div style={{ overflowY: 'auto', flex: 1 }}>
    {processing && <p role="status">正在处理，完成后自动更新。</p>}
    {(failed || page.failed) && <p role="alert">此策略处理未全部成功，已完成部分保留。</p>}
    {page.items.map((item, index) => <div key={`${item.itemRef}:${index}`} style={{ padding: '8px 0', borderBottom: `1px solid ${theme.border}` }}>
      <div style={{ fontSize: 12, color: theme.secondary }}>说话人 {item.speaker + 1} · {clock(item.startAtMillis)} <button style={button} aria-label={`播放 ${clock(item.startAtMillis)} 的发言`} onClick={() => { void play(item.itemRef) }}>播放</button></div>
      <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{item.text}</p>
    </div>)}
    {page.complete && page.items.length === 0 && <p>没有可展示的转写内容</p>}
    {error && <p role="alert">{error}</p>}
    {(!page.complete || error) && <button style={button} disabled={busy} onClick={() => { void load(page.nextCursor) }}>{busy ? '加载中…' : page.nextCursor ? '加载更多' : '刷新结果'}</button>}
  </div>
}
