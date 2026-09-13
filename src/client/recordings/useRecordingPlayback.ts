import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingPlayback, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'

export interface RecordingPlaybackController {
  activeItemRef: string
  /** Timeline cursor: user selection while idle, owner-offset-mapped media position during playback. */
  positionAtMillis: number | undefined
  isPlaying: boolean
  isLoading: boolean
  error: string
  playItem(item: ArkmeRecordingWorkbenchItem, seekAtMillis?: number): Promise<void>
  playAt(items: readonly ArkmeRecordingWorkbenchItem[], selectedAtMillis: number): Promise<void>
  selectAt(items: readonly ArkmeRecordingWorkbenchItem[], selectedAtMillis: number): Promise<void>
  pause(): void
  toggleAt(items: readonly ArkmeRecordingWorkbenchItem[], selectedAtMillis: number): Promise<void>
  toggle(fallbackItem?: ArkmeRecordingWorkbenchItem): Promise<void>
  stop(): void
}

export function useRecordingPlayback(mediaPath: string, loadFollowing?: (last: ArkmeRecordingWorkbenchItem, signal: AbortSignal) => Promise<readonly ArkmeRecordingWorkbenchItem[]>): RecordingPlaybackController {
  const audioRef = useRef<{ audio: HTMLAudioElement; item: ArkmeRecordingWorkbenchItem; playback: ArkmeRecordingPlayback }>()
  const cleanupRef = useRef<() => void>()
  const requestAbortRef = useRef<AbortController>()
  const requestRevisionRef = useRef(0)
  const queueRef = useRef<{ items: readonly ArkmeRecordingWorkbenchItem[]; index: number; continuePages: boolean }>()
  const followingRef = useRef(loadFollowing)
  followingRef.current = loadFollowing
  const [activeItemRef, setActiveItemRef] = useState('')
  const [positionAtMillis, setPositionAtMillis] = useState<number>()
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const releaseMedia = useCallback((clearPosition = false) => {
    const audio = audioRef.current?.audio
    cleanupRef.current?.()
    cleanupRef.current = undefined
    audio?.pause()
    audioRef.current = undefined
    setActiveItemRef('')
    if (clearPosition) setPositionAtMillis(undefined)
    setIsPlaying(false)
  }, [])

  const cancelRequest = useCallback(() => {
    requestRevisionRef.current += 1
    requestAbortRef.current?.abort()
    requestAbortRef.current = undefined
    setIsLoading(false)
  }, [])

  const stop = useCallback(() => {
    cancelRequest()
    queueRef.current = undefined
    setError('')
    releaseMedia(true)
  }, [cancelRequest, releaseMedia])

  useEffect(() => stop, [stop])

  const openItem = async (item: ArkmeRecordingWorkbenchItem, seekAtMillis: number) => {
    const requestRevision = ++requestRevisionRef.current
    requestAbortRef.current?.abort()
    const requestController = new AbortController()
    requestAbortRef.current = requestController
    setError(''); releaseMedia(false)
    setPositionAtMillis(seekAtMillis)
    setIsLoading(true)
    try {
      const playback = await callArkme<ArkmeRecordingPlayback>(
        'recordings.playback.open',
        { itemRef: item.itemRef },
        requestController.signal,
      )
      if (requestRevisionRef.current !== requestRevision) return
      const audio = new Audio(`${mediaPath}?ref=${encodeURIComponent(playback.playbackRef)}`)
      audioRef.current = { audio, item, playback }
      const relativeSeekMillis = Math.min(
        playback.endOffsetMillis,
        Math.max(playback.startOffsetMillis, playback.startOffsetMillis + seekAtMillis - item.startAtMillis),
      )
      audio.currentTime = relativeSeekMillis / 1000
      setPositionAtMillis(seekAtMillis)
      const onTimeUpdate = () => {
        if (audioRef.current?.audio !== audio) return
        const mediaPositionMillis = audio.currentTime * 1_000
        setPositionAtMillis(item.startAtMillis + mediaPositionMillis - playback.startOffsetMillis)
        if (!audio.paused && mediaPositionMillis >= playback.endOffsetMillis) void continueQueue()
      }
      const onPlay = () => { if (audioRef.current?.audio === audio) setIsPlaying(true) }
      const onPause = () => { if (audioRef.current?.audio === audio) setIsPlaying(false) }
      const onEnded = () => { if (audioRef.current?.audio === audio) void continueQueue() }
      const onError = () => {
        if (audioRef.current?.audio !== audio) return
        cancelRequest()
        setError('录音播放失败'); queueRef.current = undefined; releaseMedia(false)
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
      releaseMedia(false)
    } finally {
      if (requestRevisionRef.current === requestRevision) {
        if (requestAbortRef.current === requestController) requestAbortRef.current = undefined
        setIsLoading(false)
      }
    }
  }

  const continueQueue = async () => {
    const queue = queueRef.current
    if (queue === undefined) return
    let next = queue.items[queue.index + 1]
    if (next === undefined && queue.continuePages && followingRef.current !== undefined) {
      const revision = ++requestRevisionRef.current
      const controller = new AbortController()
      requestAbortRef.current?.abort(); requestAbortRef.current = controller
      // Remove ended/timeupdate listeners before awaiting another page so the
      // same media end cannot advance the queue twice.
      releaseMedia(false); setIsLoading(true)
      try {
        const items = await followingRef.current(queue.items[queue.index]!, controller.signal)
        controller.signal.throwIfAborted()
        if (requestRevisionRef.current !== revision || queueRef.current !== queue) return
        const index = items.findIndex(item => item.itemId === queue.items[queue.index]!.itemId)
        if (index < 0) throw new Error('录音内容已更新，请重新选择播放位置')
        next = items[index + 1]
        if (next !== undefined) {
          queueRef.current = { items, index: index + 1, continuePages: true }
          await openItem(next, next.startAtMillis)
          return
        }
      } catch (reason) {
        if (requestRevisionRef.current !== revision) return
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '后续录音读取失败')
      } finally {
        if (requestRevisionRef.current === revision) {
          requestAbortRef.current = undefined; setIsLoading(false)
        }
      }
      if (requestRevisionRef.current !== revision) return
    }
    if (next === undefined) {
      cancelRequest(); queueRef.current = undefined; releaseMedia()
      return
    }
    queueRef.current = { ...queue, index: queue.index + 1 }
    await openItem(next, next.startAtMillis)
  }

  const playItem = async (item: ArkmeRecordingWorkbenchItem, seekAtMillis = item.startAtMillis) => {
    queueRef.current = { items: [item], index: 0, continuePages: false }
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
    queueRef.current = { items: ordered, index, continuePages: true }
    const selectedItem = ordered[index]!
    const active = audioRef.current
    if (active !== undefined && !active.audio.paused
      && active.item.itemRef === selectedItem.itemRef
      && active.item.startAtMillis === selectedItem.startAtMillis
      && active.item.endAtMillis === selectedItem.endAtMillis) {
      try {
        // Absolute day time and owner-relative media offset are different coordinates.
        active.audio.currentTime = Math.min(active.playback.endOffsetMillis, Math.max(
          active.playback.startOffsetMillis,
          active.playback.startOffsetMillis + selectedAtMillis - selectedItem.startAtMillis,
        )) / 1_000
        setPositionAtMillis(selectedAtMillis)
      } catch (reason) {
        stop()
        setPositionAtMillis(selectedAtMillis)
        setError(reason instanceof Error ? reason.message : '录音播放失败')
      }
      return
    }
    await openItem(selectedItem, selectedAtMillis)
  }

  const selectAt = async (items: readonly ArkmeRecordingWorkbenchItem[], selectedAtMillis: number) => {
    // Read the live media/request, not a render snapshot: rapid selections can share a render.
    if (requestAbortRef.current !== undefined || (audioRef.current !== undefined && !audioRef.current.audio.paused)) {
      await playAt(items, selectedAtMillis)
    } else {
      stop()
      setPositionAtMillis(selectedAtMillis)
    }
  }

  const pause = () => {
    if (requestAbortRef.current !== undefined) {
      cancelRequest()
      queueRef.current = undefined
      releaseMedia(false)
    } else {
      audioRef.current?.audio.pause()
    }
  }

  const toggleAt = async (items: readonly ArkmeRecordingWorkbenchItem[], selectedAtMillis: number) => {
    if (requestAbortRef.current !== undefined || (audioRef.current !== undefined && !audioRef.current.audio.paused)) {
      pause()
    } else {
      await playAt(items, selectedAtMillis)
    }
  }

  const toggle = async (fallbackItem?: ArkmeRecordingWorkbenchItem) => {
    if (requestAbortRef.current !== undefined) { pause(); return }
    const audio = audioRef.current?.audio
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
      if (audioRef.current?.audio !== audio) return
      setError(reason instanceof Error ? reason.message : '录音播放失败')
      queueRef.current = undefined
      releaseMedia()
    }
  }

  return { activeItemRef, positionAtMillis, isPlaying, isLoading, error, playItem, playAt, selectAt, pause, toggleAt, toggle, stop }
}
