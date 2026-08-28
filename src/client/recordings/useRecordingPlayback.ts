import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingPlayback, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'

export interface RecordingPlaybackController {
  activeItemRef: string
  positionAtMillis: number | undefined
  isPlaying: boolean
  error: string
  playItem(item: ArkmeRecordingWorkbenchItem, seekAtMillis?: number): Promise<void>
  pause(): void
  toggle(fallbackItem?: ArkmeRecordingWorkbenchItem): Promise<void>
  stop(): void
}

export function useRecordingPlayback(mediaPath: string): RecordingPlaybackController {
  const audioRef = useRef<HTMLAudioElement>()
  const cleanupRef = useRef<() => void>()
  const requestRevisionRef = useRef(0)
  const [activeItemRef, setActiveItemRef] = useState('')
  const [positionAtMillis, setPositionAtMillis] = useState<number>()
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState('')

  const release = useCallback(() => {
    const audio = audioRef.current
    cleanupRef.current?.()
    cleanupRef.current = undefined
    audio?.pause()
    audioRef.current = undefined
    setActiveItemRef('')
    setPositionAtMillis(undefined)
    setIsPlaying(false)
  }, [])

  const stop = useCallback(() => {
    requestRevisionRef.current += 1
    release()
  }, [release])

  useEffect(() => stop, [stop])

  const playItem = async (item: ArkmeRecordingWorkbenchItem, seekAtMillis = item.startAtMillis) => {
    const requestRevision = ++requestRevisionRef.current
    setError(''); release()
    try {
      const playback = await callArkme<ArkmeRecordingPlayback>('recordings.playback.open', { itemRef: item.itemRef })
      if (requestRevisionRef.current !== requestRevision) return
      const audio = new Audio(`${mediaPath}?ref=${encodeURIComponent(playback.playbackRef)}`)
      audioRef.current = audio
      const relativeSeekMillis = Math.min(
        playback.endOffsetMillis,
        Math.max(playback.startOffsetMillis, playback.startOffsetMillis + seekAtMillis - item.startAtMillis),
      )
      audio.currentTime = relativeSeekMillis / 1000
      setPositionAtMillis(seekAtMillis)
      const onTimeUpdate = () => {
        if (audioRef.current !== audio) return
        const mediaPositionMillis = audio.currentTime * 1_000
        setPositionAtMillis(item.startAtMillis + mediaPositionMillis - playback.startOffsetMillis)
        if (mediaPositionMillis >= playback.endOffsetMillis) release()
      }
      const onPlay = () => { if (audioRef.current === audio) setIsPlaying(true) }
      const onPause = () => { if (audioRef.current === audio) setIsPlaying(false) }
      const onError = () => {
        if (audioRef.current !== audio) return
        setError('录音播放失败'); release()
      }
      audio.addEventListener('timeupdate', onTimeUpdate)
      audio.addEventListener('play', onPlay)
      audio.addEventListener('pause', onPause)
      audio.addEventListener('error', onError)
      cleanupRef.current = () => {
        audio.removeEventListener('timeupdate', onTimeUpdate)
        audio.removeEventListener('play', onPlay)
        audio.removeEventListener('pause', onPause)
        audio.removeEventListener('error', onError)
      }
      setActiveItemRef(item.itemRef)
      await audio.play()
    } catch (reason) {
      if (requestRevisionRef.current !== requestRevision) return
      setError(reason instanceof Error ? reason.message : '录音播放失败')
      release()
    }
  }

  const pause = () => { audioRef.current?.pause() }

  const toggle = async (fallbackItem?: ArkmeRecordingWorkbenchItem) => {
    const audio = audioRef.current
    if (audio === undefined) {
      if (fallbackItem !== undefined) await playItem(fallbackItem)
      return
    }
    if (audio.paused) await audio.play()
    else audio.pause()
  }

  return { activeItemRef, positionAtMillis, isPlaying, error, playItem, pause, toggle, stop }
}
