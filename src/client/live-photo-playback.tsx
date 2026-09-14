import { useEffect, useRef, useState } from 'react'
import type { ArkmeContentBlock } from '../types.js'
import { arkmeLocalFileUrl, useArkmeOriginal } from './ArkmeFileViewer.js'
import { ArkmeLivePhotoBadge } from './ArkmeLivePhotoBadge.js'

/** Disposable preview state; reception, authentication and retries stay with the existing file owner. */
export function useArkmeLivePhotoPlayback(cover: ArkmeContentBlock) {
  const photo = cover.kind === 'image' ? cover.dynamicPhoto : undefined
  const motion = photo?.motion
  const identity = `${cover.mediaRef}\0${motion?.mediaRef ?? ''}`
  const [state, setState] = useState<{ identity: string; phase: 'loading' | 'playing' | 'failed'; error?: string }>()
  const phase = state?.identity === identity ? state.phase : undefined
  const reception = useArkmeOriginal(motion)
  const videoRef = useRef<HTMLVideoElement>(null)
  const requested = useRef(false)
  const active = phase === 'loading' || phase === 'playing'
  const fail = (message: string) => { requested.current = false; setState({ identity, phase: 'failed', error: message }) }
  const finish = () => { requested.current = false; setState(undefined) }
  useEffect(() => {
    setState(undefined)
    requested.current = false
    return () => { requested.current = false }
  }, [identity])
  useEffect(() => {
    const video = videoRef.current
    return () => { video?.pause() }
  }, [identity, active, reception.localRef])
  useEffect(() => {
    if (active && reception.reception.state === 'failed') fail(reception.reception.error ?? '动态片段接收失败，请重试')
  }, [identity, active, reception.reception.state, reception.reception.error])
  const start = () => {
    if (motion === undefined || requested.current) return
    requested.current = true
    setState({ identity, phase: 'loading' })
    if (reception.localRef === undefined) reception.receive()
  }
  return {
    playing: phase === 'playing',
    video: active && reception.localRef !== undefined ? <video
      key={identity} ref={videoRef} src={arkmeLocalFileUrl(reception.localRef)} muted playsInline
      aria-label={`实况 ${cover.fileName}`}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', visibility: phase === 'playing' ? 'visible' : 'hidden' }}
      onCanPlay={event => {
        const video = event.currentTarget
        void video.play().catch(() => { if (videoRef.current === video) fail('动态片段播放失败，请重试') })
      }}
      onPlaying={() => setState({ identity, phase: 'playing' })}
      onEnded={finish} onPause={event => { if (videoRef.current === event.currentTarget && phase === 'playing') finish() }} onError={() => fail('动态片段播放失败，请重试')}
    /> : null,
    control: photo === undefined ? null : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" data-arkme-live-photo-control
        aria-label={phase === 'loading' ? '实况加载中' : motion === undefined ? '实况动态片段不可用' : '播放实况'}
        aria-busy={phase === 'loading'}
        title={motion === undefined ? '实况动态片段不可用' : '播放实况'}
        disabled={active || motion === undefined} onClick={start}
        style={{ visibility: phase === 'playing' ? 'hidden' : 'visible', display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 16, padding: 0, background: 'transparent', color: '#fff', fontSize: 12, cursor: active ? 'progress' : motion === undefined ? 'default' : 'pointer' }}>
        <ArkmeLivePhotoBadge />
      </button>
      {phase === 'failed' && <span role="alert" style={{ position: 'absolute', bottom: 40, left: 0, width: 'max-content', maxWidth: 'min(320px, 70vw)', textAlign: 'left', fontSize: 12 }}>{state?.error}</span>}
    </span>,
  }
}
