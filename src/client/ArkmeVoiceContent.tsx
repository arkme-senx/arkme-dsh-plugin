import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { SpinnerGap } from '@phosphor-icons/react/dist/icons/SpinnerGap'
import { arkmeTheme } from './arkme-theme.js'
import { loadCompatibleVoice } from './arkme-voice-compat.js'

const styles: Record<string, CSSProperties> = {
  root: { maxWidth: '100%', minWidth: 0, color: 'inherit', fontSize: 15, lineHeight: '22px' },
  content: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  control: { display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', gap: 5, padding: 0, margin: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', lineHeight: '22px', cursor: 'pointer', whiteSpace: 'nowrap' },
  duration: { fontVariantNumeric: 'tabular-nums' },
  transcript: { marginLeft: 12 },
  action: { border: 0, padding: 0, background: 'transparent', color: arkmeTheme.tertiary, font: 'inherit', fontSize: 12, lineHeight: '20px', cursor: 'pointer' },
  error: { color: arkmeTheme.secondary, fontSize: 12, lineHeight: '20px' },
}

export function arkmeVoiceDuration(seconds?: number, elapsed = false): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0 || (!elapsed && seconds === 0)) return '--:--'
  const total = elapsed ? Math.floor(seconds) : Math.ceil(seconds)
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`
}

export function arkmeVoiceMediaUrl(mediaRef: string): string {
  return `/arkme-self/api/media?ref=${encodeURIComponent(mediaRef)}`
}

export interface ArkmeVoiceContentProps {
  /** Account/source-scoped identity; changing it releases previous playback. */
  sourceKey: string
  src?: string | undefined
  /** Ordered media segments. They are loaded and played one at a time. */
  playlist?: readonly string[] | undefined
  durationSeconds?: number | undefined
  resolveSrc?: ((signal: AbortSignal) => Promise<string>) | undefined
  /** Optional presentation placed between the play control and duration. */
  visualization?: ReactNode
  /** Accessible content name used by play/loading/error copy. */
  contentLabel?: string | undefined
  children?: ReactNode
  collapsible?: boolean | undefined
  maxLines?: number | undefined
  downloadName?: string | undefined
}

interface VoiceLease { cancel(): void }
// Short-voice UI ownership only. No persistent media cache or account data.
let activeVoice: VoiceLease | undefined

export function ArkmeVoiceContent(props: ArkmeVoiceContentProps) {
  return <VoiceContent key={JSON.stringify([props.sourceKey, props.src ?? '', props.playlist ?? []])} {...props} />
}

function VoiceContent({ src = '', playlist, durationSeconds, resolveSrc, visualization, contentLabel = '语音', children, collapsible = false, maxLines = 5, downloadName }: ArkmeVoiceContentProps) {
  const playlistSources = playlist?.filter(value => value.trim() !== '') ?? []
  const sources = playlistSources.length > 0 ? playlistSources : src === '' ? [] : [src]
  const initialSrc = sources[0] ?? ''
  const audioRef = useRef<HTMLAudioElement>(null)
  const requestRef = useRef<AbortController>()
  const leaseRef = useRef<VoiceLease>()
  const compatibleSrc = useRef<string>()
  const compatibleOriginalSrc = useRef<string>()
  const playbackSrc = useRef(initialSrc)
  const sourceIndex = useRef(0)
  const completedSeconds = useRef(0)
  const pendingPlay = useRef(false)
  const recoveryTimeout = useRef<ReturnType<typeof setTimeout>>()
  const handleMediaError = useRef<(() => void)>()
  const mounted = useRef(true)
  const [resolvedSrc, setResolvedSrc] = useState(initialSrc)
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle')
  const [showLoadingIcon, setShowLoadingIcon] = useState(false)
  const [metadataDuration, setMetadataDuration] = useState<number>()
  const [position, setPosition] = useState(0)
  const [expanded, setExpanded] = useState(false)
  // Per-segment metadata must never masquerade as a playlist total.
  const duration = sources.length > 1 ? durationSeconds : metadataDuration !== undefined && Number.isFinite(metadataDuration) && metadataDuration > 0
    ? metadataDuration : durationSeconds
  const totalLabel = arkmeVoiceDuration(duration)
  const unavailable = sources.length === 0 && resolvedSrc === '' && resolveSrc === undefined
  const normalizedContentLabel = contentLabel.trim() || '语音'

  useEffect(() => {
    // Fast/cached playback should not flash a spinner. A slower load replaces
    // only the 16px icon; it never inserts a row or shifts the transcript.
    if (status !== 'loading') { setShowLoadingIcon(false); return }
    const timer = setTimeout(() => { setShowLoadingIcon(true) }, 200)
    return () => { clearTimeout(timer) }
  }, [status])

  const release = () => {
    clearTimeout(recoveryTimeout.current)
    recoveryTimeout.current = undefined
    requestRef.current?.abort()
    requestRef.current = undefined
    if (activeVoice === leaseRef.current) activeVoice = undefined
    leaseRef.current = undefined
    handleMediaError.current = undefined
    pendingPlay.current = false
  }
  const clearCompatible = () => {
    if (compatibleSrc.current !== undefined) URL.revokeObjectURL(compatibleSrc.current)
    compatibleSrc.current = undefined
    compatibleOriginalSrc.current = undefined
  }
  useEffect(() => {
    mounted.current = true
    const audio = audioRef.current
    return () => {
      mounted.current = false
      release()
      audio?.pause()
      clearCompatible()
    }
  }, [])

  const fail = () => {
    release()
    audioRef.current?.pause()
    clearCompatible()
    if (mounted.current) setStatus('error')
  }
  const playSource = async (url: string, index: number, lease: VoiceLease, controller: AbortController) => {
    const isCurrent = () => mounted.current && !controller.signal.aborted && leaseRef.current === lease
    if (!isCurrent()) return
    if (sourceIndex.current !== index || compatibleOriginalSrc.current !== url) clearCompatible()
    sourceIndex.current = index
    setResolvedSrc(url)
    pendingPlay.current = true
    setStatus('loading')
    try {
      const audio = audioRef.current
      if (audio === null) { release(); setStatus('idle'); return }
      const mediaUrl = compatibleOriginalSrc.current === url ? compatibleSrc.current ?? url : url
      if (playbackSrc.current !== mediaUrl) { audio.src = mediaUrl; playbackSrc.current = mediaUrl }
      let recovering = false
      let attempted = false
      const recover = async () => {
        if (!isCurrent() || recovering) return
        if (attempted || compatibleSrc.current !== undefined || audio.error?.code !== 3) { fail(); return }
        attempted = true
        recovering = true
        pendingPlay.current = true
        setStatus('loading')
        const timeout = setTimeout(() => { if (isCurrent()) fail() }, 15_000)
        recoveryTimeout.current = timeout
        try {
          const blob = await loadCompatibleVoice(url, controller.signal)
          if (!isCurrent()) return
          const objectUrl = URL.createObjectURL(blob)
          compatibleSrc.current = objectUrl
          compatibleOriginalSrc.current = url
          playbackSrc.current = objectUrl
          audio.src = objectUrl
          await audio.play()
          if (!isCurrent()) { if (leaseRef.current === undefined) audio.pause(); return }
          setStatus('playing')
        } catch {
          if (isCurrent()) fail()
        } finally {
          clearTimeout(timeout)
          if (recoveryTimeout.current === timeout) recoveryTimeout.current = undefined
          recovering = false
          if (isCurrent()) pendingPlay.current = false
        }
      }
      handleMediaError.current = () => { void recover() }
      if (audio.error?.code === 3) { await recover(); return }
      // Retry a failed media load, but do not reset a normally paused voice.
      if (audio.error !== null && audio.error !== undefined) audio.load()
      if (audio.ended) audio.currentTime = 0
      try { await audio.play() } catch {
        if (isCurrent()) await recover()
        return
      }
      if (!isCurrent()) {
        if (leaseRef.current === undefined) audio.pause()
        return
      }
      if (!recovering) { pendingPlay.current = false; setStatus('playing') }
    } catch {
      if (isCurrent()) fail()
    }
  }

  const toggle = async () => {
    if (unavailable) return
    if (leaseRef.current !== undefined) {
      leaseRef.current.cancel()
      return
    }
    activeVoice?.cancel()
    const controller = new AbortController()
    requestRef.current = controller
    const lease: VoiceLease = { cancel: () => {
      release()
      audioRef.current?.pause()
      if (mounted.current) setStatus('paused')
    } }
    leaseRef.current = lease
    activeVoice = lease
    let url = sources[sourceIndex.current] ?? resolvedSrc
    if (url === '') {
      pendingPlay.current = true
      setStatus('loading')
      try { url = await resolveSrc?.(controller.signal) ?? '' } catch {
        if (leaseRef.current === lease && !controller.signal.aborted) fail()
        return
      }
    }
    if (leaseRef.current !== lease || controller.signal.aborted) return
    if (url === '') { fail(); return }
    await playSource(url, sourceIndex.current, lease, controller)
  }

  const label = status === 'loading' ? `正在加载${normalizedContentLabel}` : unavailable ? `${normalizedContentLabel}暂不可播放` : status === 'error' ? `重试播放${normalizedContentLabel}` : status === 'playing' ? `暂停${normalizedContentLabel}` : `播放${normalizedContentLabel}`
  return <div style={styles.root} data-arkme-voice="inline" data-arkme-voice-state={status}>
    <div style={{ ...styles.content, ...(!expanded && collapsible ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxLines, overflow: 'hidden' } as CSSProperties : {}) }}>
      <button
        type="button"
        style={{ ...styles.control, ...(unavailable ? { opacity: .5, cursor: 'default' } : {}) }}
        disabled={unavailable}
        aria-label={`${label}，时长 ${totalLabel}`}
        aria-pressed={status === 'playing'}
        aria-busy={status === 'loading'}
        title={status === 'loading' ? '正在加载，点击取消' : label}
        onClick={event => { event?.stopPropagation(); void toggle() }}
        onKeyDown={event => { event.stopPropagation() }}
        onKeyUp={event => { event.stopPropagation() }}
      >
        {status === 'loading' && showLoadingIcon
          ? <SpinnerGap size={16} weight="bold" aria-hidden className="arkme-icon-spin" data-arkme-voice-loading="true" />
          : status === 'playing' ? <Pause size={16} weight="fill" aria-hidden /> : <Play size={16} weight="fill" aria-hidden />}
        {visualization !== undefined && visualization !== null && <span data-arkme-voice-visualization="true">{visualization}</span>}
        <span style={styles.duration}>{status === 'playing' ? arkmeVoiceDuration(position, true) : totalLabel}</span>
      </button>
      {children !== undefined && children !== null && children !== '' && <span style={styles.transcript} data-arkme-voice-transcript="true">{children}</span>}
    </div>
    {collapsible && <button type="button" style={styles.action} aria-expanded={expanded}
      onClick={event => { event.stopPropagation(); setExpanded(value => !value) }}
      onKeyDown={event => { event.stopPropagation() }} onKeyUp={event => { event.stopPropagation() }}
    >{expanded ? '收起' : '展开'}</button>}
    {status === 'error' && <div style={styles.error} role="status">{normalizedContentLabel}加载或播放失败，请点击播放重试。
      {resolvedSrc !== '' && downloadName !== undefined && <>{' '}<a href={resolvedSrc} download={downloadName} style={styles.action} onClick={event => { event.stopPropagation() }}>下载{normalizedContentLabel}</a></>}
    </div>}
    {/* The keyed instance owns its initial src. Lazy resolution sets audio.src
        once in toggle; mirroring it here reloads media and aborts the first play. */}
    <audio
      ref={audioRef} src={initialSrc || undefined} preload="metadata" style={{ display: 'none' }}
      onLoadedMetadata={event => { setMetadataDuration(event.currentTarget.duration) }}
      onDurationChange={event => { setMetadataDuration(event.currentTarget.duration) }}
      onTimeUpdate={event => { setPosition(completedSeconds.current + event.currentTarget.currentTime) }}
      onPlay={() => {
        if (leaseRef.current === undefined || activeVoice !== leaseRef.current) { audioRef.current?.pause(); return }
        setStatus('playing')
      }}
      onPause={event => {
        // Ignore a queued pause event after a newer play has already started.
        if (!event.currentTarget.paused) return
        // Source replacement and decode failure both queue pause events. The
        // active play/recovery attempt owns those, not a user pause operation.
        if (pendingPlay.current || (leaseRef.current !== undefined && event.currentTarget.error !== null && event.currentTarget.error !== undefined)) return
        release(); if (mounted.current) setStatus(value => value === 'error' ? value : 'paused')
      }}
      onEnded={event => {
        const lease = leaseRef.current
        const controller = requestRef.current
        const nextIndex = sourceIndex.current + 1
        const nextSource = sources[nextIndex]
        if (lease !== undefined && controller !== undefined && nextSource !== undefined) {
          const completed = Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0
            ? event.currentTarget.duration : event.currentTarget.currentTime
          completedSeconds.current += Math.max(0, completed)
          pendingPlay.current = true
          void playSource(nextSource, nextIndex, lease, controller)
          return
        }
        release()
        sourceIndex.current = 0
        completedSeconds.current = 0
        setStatus('idle')
        setPosition(0)
      }}
      onError={() => {
        if (handleMediaError.current !== undefined) handleMediaError.current()
        // A recoverable preload decode error is not a failed user play. Wait
        // for a click before fetching/remuxing, without flashing an error row.
        else if (audioRef.current?.error?.code === 3 && compatibleSrc.current === undefined) {
          setStatus(value => value === 'error' ? value : 'idle')
        } else fail()
      }}
    />
  </div>
}
