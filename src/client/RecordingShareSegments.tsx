import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeForwardTranscriptSegment } from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
import { recordingSpeakerColor } from './recordings/recording-speaker-presentation.js'

const rowStyle: CSSProperties = {
  display: 'block', width: '100%', color: 'inherit', padding: '8px 10px', textAlign: 'left',
  background: 'transparent', border: 0, borderRadius: 6, font: 'inherit',
}

function recordingOffset(millis: number): string {
  const seconds = Math.floor(millis / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')
}

export function RecordingShareSegments({ segments, audioUrl, loadAudio, unavailableText }: {
  segments: readonly ArkmeForwardTranscriptSegment[]
  audioUrl?: string | undefined
  unavailableText?: string | undefined
  loadAudio?: ((signal: AbortSignal) => Promise<string>) | undefined
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const selection = useRef<{ index: number; start: number; end: number }>()
  const pendingSeek = useRef(false)
  const attempt = useRef(0)
  const request = useRef<AbortController>()
  const [error, setError] = useState('')
  const [active, setActive] = useState<number>()
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  let offset = 0
  const rows = segments.map((segment, index) => {
    const start = offset
    offset += (segment.endMillis - segment.startMillis) / 1000
    return { segment, index, start, end: offset }
  })
  const duration = offset

  useEffect(() => {
    const element = audio.current
    return () => {
      attempt.current++
      request.current?.abort()
      element?.pause()
    }
  }, [audioUrl])

  const stopAtBoundary = (element: HTMLAudioElement) => {
    const end = selection.current?.end
    if (end === undefined || element.paused || element.currentTime < end) return
    element.pause()
    element.currentTime = end
  }

  useEffect(() => {
    if (status !== 'playing') return
    let frame = 0
    const checkEnd = () => {
      const element = audio.current
      if (!element || element.paused) return
      stopAtBoundary(element)
      if (!element.paused) frame = requestAnimationFrame(checkEnd)
    }
    frame = requestAnimationFrame(checkEnd)
    return () => cancelAnimationFrame(frame)
  }, [status])

  const fail = (element: HTMLAudioElement) => {
    pendingSeek.current = false
    attempt.current++
    element.pause()
    setStatus('error')
  }
  const seek = (element: HTMLAudioElement) => {
    if (!selection.current || !pendingSeek.current || request.current) return
    if (!Number.isFinite(element.duration) || Math.abs(element.duration - duration) > 0.05) {
      fail(element)
      return
    }
    pendingSeek.current = false
    element.currentTime = selection.current.start
  }
  const toggle = async ({ index, start, end }: typeof rows[number]) => {
    const element = audio.current
    if (!element || end <= start) return
    const same = selection.current?.index === index
    const version = ++attempt.current
    request.current?.abort()
    if (same && (status === 'loading' || !element.paused)) {
      pendingSeek.current = false
      element.pause()
      setStatus('idle')
      return
    }
    if (!element.paused) element.pause()
    selection.current = { index, start, end }
    setError('')
    setActive(index)
    setStatus('loading')
    if (loadAudio) {
      const controller = new AbortController()
      request.current = controller
      try {
        const url = await loadAudio(controller.signal)
        if (attempt.current !== version || controller.signal.aborted) return
        element.src = url
        element.load()
      } catch (cause) {
        if (attempt.current === version && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : tr('音频播放失败，请点击片段重试'))
          fail(element)
        }
        return
      } finally { if (request.current === controller) request.current = undefined }
    } else if (element.error) element.load()
    pendingSeek.current = !same || element.currentTime < start || element.currentTime >= end || element.readyState < 1
    if (element.readyState >= 1) seek(element)
    if (attempt.current !== version) return
    void element.play().then(() => {
      if (attempt.current === version) setStatus('playing')
    }, () => {
      if (attempt.current === version) fail(element)
    })
  }
  return <section aria-label={tr('已分享的录音片段')}>
    {(audioUrl || loadAudio) && <audio ref={audio} src={audioUrl} preload="none"
      onLoadedMetadata={event => seek(event.currentTarget)}
      onTimeUpdate={event => stopAtBoundary(event.currentTarget)}
      onPause={event => { if (event.currentTarget.paused && !request.current && !pendingSeek.current) setStatus(value => value === 'error' ? value : 'idle') }}
      onEnded={() => setStatus('idle')}
      onError={event => { if (!request.current) fail(event.currentTarget) }} />}
    {!audioUrl && !loadAudio && <p style={{ margin: '4px 10px', fontSize: 12, color: arkmeTheme.secondary }}>{unavailableText ?? tr('音频暂不可用')}</p>}
    {rows.map(row => {
      const { segment, index, start, end } = row
      const selected = active === index
      const playable = Boolean((audioUrl || loadAudio) && end > start)
      const playing = selected && status === 'playing'
      const loading = selected && status === 'loading'
      const body = <>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          {playable && <span aria-hidden style={{ width: 14 }}>{loading ? '…' : playing ? 'Ⅱ' : '▶'}</span>}
          <span aria-hidden style={{ width: 11, height: 11, flex: 'none', borderRadius: '50%', background: recordingSpeakerColor(segment.speakerNumber ?? index) }} />
          <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{segment.speakerName}</span>
          <time style={{ color: arkmeTheme.secondary, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{recordingOffset(segment.startMillis)}</time>
        </span>
        <span style={{ display: 'block', marginTop: 5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.65 }}>
          {segment.textContent}
        </span>
      </>
      return <div key={index} data-arkme-shared-recording-segment style={{ borderTop: index ? `1px solid ${arkmeTheme.borderSoft}` : undefined }}>
        {playable ? <button type="button" aria-busy={loading || undefined}
          aria-label={`${tr(playing || loading ? '暂停' : '播放')} · ${segment.speakerName} · ${recordingOffset(segment.startMillis)}`}
          style={{ ...rowStyle, cursor: 'pointer', background: selected ? arkmeTheme.accentSoft : 'transparent' }}
          onClick={() => { void toggle(row) }}>{body}</button>
          : <div style={rowStyle}>{body}</div>}
        {selected && status === 'error' && <span role="alert" style={{ marginLeft: 10, fontSize: 12, color: arkmeTheme.secondary }}>{error || tr('音频播放失败，请点击片段重试')}</span>}
      </div>
    })}
  </section>
}
