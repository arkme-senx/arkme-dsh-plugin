import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeCallTranscriptSegment } from '../types.js'

type PlaybackState = { segmentId: string; status: 'loading' | 'playing' | 'failed' }

/** Each URL is already a clipped utterance, matching Flutter's segment playback. */
export function useCallTranscriptPlayback(callRef: string, beforePlay: () => void) {
  const [state, setState] = useState<PlaybackState>()
  const active = useRef<{ audio: HTMLAudioElement; segmentId: string }>()
  const generation = useRef(0)
  const release = useCallback(() => {
    generation.current++
    const current = active.current
    active.current = undefined
    if (!current) return
    current.audio.onended = null
    current.audio.onerror = null
    current.audio.onplaying = null
    current.audio.onwaiting = null
    current.audio.pause()
    current.audio.removeAttribute('src')
    current.audio.load()
  }, [])
  const stop = useCallback(() => { release(); setState(undefined) }, [release])
  useEffect(() => { setState(undefined); return release }, [callRef, release])

  const toggle = (segment: ArkmeCallTranscriptSegment) => {
    if (!segment.audioUrl?.trim()) return
    if (active.current?.segmentId === segment.segmentId) { stop(); return }
    stop()
    beforePlay()
    const request = generation.current
    const valid = () => generation.current === request
    const fail = () => {
      if (!valid()) return
      release()
      setState({ segmentId: segment.segmentId, status: 'failed' })
    }
    setState({ segmentId: segment.segmentId, status: 'loading' })
    try {
      const audio = new Audio(segment.audioUrl)
      active.current = { audio, segmentId: segment.segmentId }
      audio.onended = () => { if (valid()) stop() }
      audio.onerror = fail
      audio.onplaying = () => { if (valid()) setState({ segmentId: segment.segmentId, status: 'playing' }) }
      audio.onwaiting = () => { if (valid()) setState({ segmentId: segment.segmentId, status: 'loading' }) }
      void audio.play().then(() => {
        if (valid()) setState({ segmentId: segment.segmentId, status: 'playing' })
      }).catch(fail)
    } catch { fail() }
  }
  return { state, toggle, stop }
}
