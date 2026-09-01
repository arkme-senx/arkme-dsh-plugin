import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingPlayback, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'

export interface RecordingPlaybackController {
  activeItemRef: string
  positionAtMillis: number | undefined
  isPlaying: boolean
  error: string
  playItem(item: ArkmeRecordingWorkbenchItem, seekAtMillis?: number): Promise<void>
  playAt(items: readonly ArkmeRecordingWorkbenchItem[], selectedAtMillis: number): Promise<void>
  pause(): void
  toggle(fallbackItem?: ArkmeRecordingWorkbenchItem): Promise<void>
  stop(): void
}

export function useRecordingPlayback(mediaPath: string): RecordingPlaybackController {
  const audioRef = useRef<HTMLAudioElement>()
  const cleanupRef = useRef<() => void>()
  const requestAbortRef = useRef<AbortController>()
  const requestRevisionRef = useRef(0)
  const queueRef = useRef<{ items: readonly ArkmeRecordingWorkbenchItem[]; index: number }>()
  const advancingRef = useRef(false)
  const [activeItemRef, setActiveItemRef] = useState('')
  const [positionAtMillis, setPositionAtMillis] = useState<number>()
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState('')

  const releaseMedia = useCallback((clearPosition = true) => {
    const audio = audioRef.current
    cleanupRef.current?.()
    cleanupRef.current = undefined
    audio?.pause()
    audioRef.current = undefined
    setActiveItemRef('')
    if (clearPosition) setPositionAtMillis(undefined)
    setIsPlaying(false)
  }, [])

  const stop = useCallback(() => {
    requestRevisionRef.current += 1
    requestAbortRef.current?.abort()
    requestAbortRef.current = undefined
    queueRef.current = undefined
    advancingRef.current = false
    releaseMedia()
  }, [releaseMedia])

  useEffect(() => stop, [stop])

  const openItem = async (item: ArkmeRecordingWorkbenchItem, seekAtMillis: number) => {
    const requestRevision = ++requestRevisionRef.current
    requestAbortRef.current?.abort()
    const requestController = new AbortController()
    requestAbortRef.current = requestController
    setError(''); releaseMedia(false)
    try {
      const playback = await callArkme<ArkmeRecordingPlayback>(
        'recordings.playback.open',
        { itemRef: item.itemRef },
        requestController.signal,
      )
      if (requestRevisionRef.current !== requestRevision) return
      if (requestAbortRef.current === requestController) requestAbortRef.current = undefined
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
        if (mediaPositionMillis >= playback.endOffsetMillis) void continueQueue()
      }
      const onPlay = () => { if (audioRef.current === audio) setIsPlaying(true) }
      const onPause = () => { if (audioRef.current === audio) setIsPlaying(false) }
      const onEnded = () => { if (audioRef.current === audio) void continueQueue() }
      const onError = () => {
        if (audioRef.current !== audio) return
        setError('录音播放失败'); queueRef.current = undefined; releaseMedia()
      }
      audio.addEventListener('timeupdate', onTimeUpdate)
      audio.addEventListener('play', onPlay)
      audio.addEventListener('pause', onPause)
      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      cleanupRef.current = () => {
        audio.removeEventListener('timeupdate', onTimeUpdate)
        audio.removeEventListener('play', onPlay)
        audio.removeEventListener('pause', onPause)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
      }
      setActiveItemRef(item.itemRef)
      await audio.play()
    } catch (reason) {
      if (requestRevisionRef.current !== requestRevision) return
      if (requestAbortRef.current === requestController) requestAbortRef.current = undefined
      setError(reason instanceof Error ? reason.message : '录音播放失败')
      queueRef.current = undefined
      releaseMedia()
    }
  }

  const continueQueue = async () => {
    if (advancingRef.current) return
    const queue = queueRef.current
    if (queue === undefined || queue.index + 1 >= queue.items.length) {
      queueRef.current = undefined
      releaseMedia()
      return
    }
    const next = queue.items[queue.index + 1]
    if (next === undefined) {
      queueRef.current = undefined
      releaseMedia()
      return
    }
    advancingRef.current = true
    queueRef.current = { items: queue.items, index: queue.index + 1 }
    try {
      await openItem(next, next.startAtMillis)
    } finally {
      advancingRef.current = false
    }
  }

  const playItem = async (item: ArkmeRecordingWorkbenchItem, seekAtMillis = item.startAtMillis) => {
    queueRef.current = { items: [item], index: 0 }
    await openItem(item, seekAtMillis)
  }

  const playAt = async (items: readonly ArkmeRecordingWorkbenchItem[], selectedAtMillis: number) => {
    const ordered = [...items].sort((left, right) => left.startAtMillis - right.startAtMillis
      || left.endAtMillis - right.endAtMillis || left.itemId.localeCompare(right.itemId))
    const index = ordered.findIndex(item => selectedAtMillis >= item.startAtMillis && selectedAtMillis < item.endAtMillis)
    if (index < 0) {
      stop()
      setPositionAtMillis(selectedAtMillis)
      return
    }
    queueRef.current = { items: ordered, index }
    await openItem(ordered[index]!, selectedAtMillis)
  }

  const pause = () => { audioRef.current?.pause() }

  const toggle = async (fallbackItem?: ArkmeRecordingWorkbenchItem) => {
    const audio = audioRef.current
    if (audio === undefined) {
      if (fallbackItem !== undefined) await playItem(fallbackItem)
      return
    }
    if (!audio.paused) {
      audio.pause()
      return
    }
    try {
      setError('')
      await audio.play()
    } catch (reason) {
      if (audioRef.current !== audio) return
      setError(reason instanceof Error ? reason.message : '录音播放失败')
      queueRef.current = undefined
      releaseMedia()
    }
  }

  return { activeItemRef, positionAtMillis, isPlaying, error, playItem, playAt, pause, toggle, stop }
}
