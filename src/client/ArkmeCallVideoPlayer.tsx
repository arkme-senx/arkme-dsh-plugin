import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play'
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import type { ArkmeCallVideoPerspective } from '../types.js'

const iconButton: CSSProperties = { display: 'grid', placeItems: 'center', width: 32, height: 32, padding: 0, border: 0, background: 'transparent', color: '#fff', cursor: 'pointer' }
function clock(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function ArkmeCallVideoPlayer({ clip, onClose }: { clip: ArkmeCallVideoPerspective; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const trigger = document.activeElement as HTMLElement | null
    close.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const elements = panel.current?.querySelectorAll<HTMLElement>('button, a[href], input:not(:disabled)')
        const first = elements?.[0]
        const last = elements?.[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); if (trigger?.isConnected) trigger.focus() }
  }, [onClose])
  const toggle = () => {
    if (!video.current) return
    if (video.current.paused) void video.current.play().catch(() => { setError(true) })
    else video.current.pause()
  }
  const content = <div role="dialog" aria-modal="true" aria-label="通话录像播放" data-arkme-video-overlay="true" onClick={event => { if (event.target === event.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center' }}>
    <div ref={panel} style={{ position: 'relative', width: 'min(920px, calc(100vw - 48px))', height: 'min(640px, calc(100dvh - 80px))', overflow: 'hidden', borderRadius: 12, background: '#000', color: '#fff' }}>
      <video ref={video} playsInline preload="metadata" src={clip.videoUrl} poster={clip.posterUrl} aria-label="通话录像" onClick={toggle} onPlay={() => { setPlaying(true); setError(false) }} onPause={() => { setPlaying(false) }} onEnded={() => { setPlaying(false) }} onError={() => { setError(true) }} onTimeUpdate={event => { setPosition(event.currentTarget.currentTime) }} onDurationChange={event => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0) }} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
      <button ref={close} type="button" aria-label="关闭录像" title="关闭录像" onClick={onClose} style={{ ...iconButton, position: 'absolute', top: 12, right: 12 }}><XIcon size={18} /></button>
      {!playing && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'grid', justifyItems: 'center', gap: 12 }}>
        <button type="button" aria-label="播放录像" title="播放" onClick={toggle} style={{ ...iconButton, width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,0,0,.6)' }}><PlayIcon size={26} weight="fill" /></button>
        <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap' }}>{clock(position)} / {clock(duration)}</span>
        {error && <span role="alert" style={{ fontSize: 12 }}>视频加载失败，请重试</span>}
      </div>}
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" aria-label={playing ? '暂停录像' : '继续播放录像'} title={playing ? '暂停' : '播放'} onClick={toggle} style={iconButton}>{playing ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}</button>
          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{clock(position)} / {clock(duration)}</span>
          <a href={clip.videoUrl} download target="_blank" rel="noopener noreferrer" aria-label="下载录像" title="下载录像" style={{ ...iconButton, marginLeft: 'auto' }}><DownloadSimpleIcon size={20} /></a>
        </div>
        <input type="range" aria-label="播放进度" min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)} disabled={!duration} onChange={event => { const value = Number(event.currentTarget.value); if (video.current) video.current.currentTime = value; setPosition(value) }} style={{ width: '100%', margin: 0, accentColor: '#fff' }} />
      </div>
    </div>
  </div>
  // Escape the drawer's stacking context so the scrim covers every app control.
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
