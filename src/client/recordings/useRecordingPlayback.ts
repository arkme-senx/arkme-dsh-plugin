import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingPlayback, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'

export function useRecordingPlayback(mediaPath: string) {
  const audioRef = useRef<HTMLAudioElement>()
  const [activeItemRef, setActiveItemRef] = useState('')
  const [positionAtMillis, setPositionAtMillis] = useState<number>()
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState('')

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = undefined
    setActiveItemRef('')
    setPositionAtMillis(undefined)
    setIsPlaying(false)
  }, [])

  useEffect(() => stop, [stop])

  const playItem = async (item: ArkmeRecordingWorkbenchItem, seekAtMillis = item.startAtMillis) => {
    setError('')
    try {
      const playback = await callArkme<ArkmeRecordingPlayback>('recordings.playback.open', { itemRef: item.itemRef })
      stop()
      const audio = new Audio(`${mediaPath}?ref=${encodeURIComponent(playback.playbackRef)}`)
      audioRef.current = audio
      const relativeSeekMillis = Math.min(
        playback.endOffsetMillis,
        Math.max(playback.startOffsetMillis, playback.startOffsetMillis + seekAtMillis - item.startAtMillis),
      )
      audio.currentTime = relativeSeekMillis / 1000
      setPositionAtMillis(seekAtMillis)
      audio.addEventListener('timeupdate', () => {
        if (audioRef.current !== audio) return
        const mediaPositionMillis = audio.currentTime * 1_000
        setPositionAtMillis(item.startAtMillis + mediaPositionMillis - playback.startOffsetMillis)
        if (mediaPositionMillis >= playback.endOffsetMillis) stop()
      })
      audio.addEventListener('play', () => { if (audioRef.current === audio) setIsPlaying(true) })
      audio.addEventListener('pause', () => { if (audioRef.current === audio) setIsPlaying(false) })
      audio.addEventListener('error', () => {
        if (audioRef.current !== audio) return
        setError('录音播放失败'); stop()
      }, { once: true })
      setActiveItemRef(item.itemRef)
      await audio.play()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录音播放失败')
      stop()
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
