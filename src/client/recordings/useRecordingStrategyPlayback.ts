import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { callArkme } from '../api.js'

/** Source and day views use the same opaque strategy-item playback contract. */
export function useRecordingStrategyPlayback(mediaPath: string, stopPlayback: MutableRefObject<(() => void) | undefined>) {
  const [activeItemRef, setActiveItemRef] = useState(''), [error, setError] = useState('')
  const player = useRef<HTMLAudioElement>(), request = useRef<AbortController>()
  const stop = () => {
    request.current?.abort(); setActiveItemRef('')
    if (player.current) {
      player.current.onerror = null; player.current.onended = null
      player.current.pause(); player.current.removeAttribute('src'); player.current.load(); player.current = undefined
    }
  }
  useEffect(() => stop, [])
  const play = async (itemRef: string) => {
    setError(''); stopPlayback.current?.(); stop(); stopPlayback.current = stop
    const controller = new AbortController(); request.current = controller
    try {
      const media = await callArkme<{ playbackRef: string }>('recordings.strategies', { action: 'playback', itemRef }, controller.signal)
      if (controller.signal.aborted) return
      const audio = new Audio(`${mediaPath}?ref=${encodeURIComponent(media.playbackRef)}`); player.current = audio
      audio.onerror = () => { if (player.current === audio) { stop(); setError('播放失败，请重试') } }
      audio.onended = () => { if (player.current === audio) stop() }
      await audio.play()
      if (!controller.signal.aborted) setActiveItemRef(itemRef)
    } catch (reason) { if (!controller.signal.aborted) { stop(); setError(reason instanceof Error ? reason.message : '播放失败') } }
  }
  return { activeItemRef, error, play, stop }
}
