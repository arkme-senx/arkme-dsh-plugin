import { useEffect, useRef, useState } from 'react'
import type { ArkmeForwardTranscriptSegment } from '../../types.js'
import type { RecordingShareAudio } from '../../recording-favorite-contract.js'

export function recordingShareRanges(segments: readonly ArkmeForwardTranscriptSegment[]) {
  let offset = 0
  return segments.map(segment => {
    const start = offset
    offset += (segment.endMillis - segment.startMillis) / 1000
    return { start, end: offset }
  })
}

/** One current clip, released on navigation/account change; never prefetch the entire recording. */
export function useRecordingSharePlayback(segments: readonly ArkmeForwardTranscriptSegment[], media: RecordingShareAudio | undefined, mediaPath: string, legacyUrl?: string) {
  const ranges = recordingShareRanges(segments), total = ranges.at(-1)?.end ?? 0
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'playing' | 'error'; index?: number; elapsed: number }>({ status: 'idle', elapsed: 0 })
  const [rate, setRate] = useState(1)
  const rateRef = useRef(1)
  const lease = useRef<{ element: HTMLAudioElement; index: number; all: boolean; sequence: number }>()
  const generation = useRef(0)
  const frame = useRef(0)
  const current = useRef(state); current.current = state
  const cleanup = () => {
    generation.current++; cancelAnimationFrame(frame.current)
    const old = lease.current; lease.current = undefined
    if (old) {
      old.element.onloadedmetadata = old.element.ontimeupdate = old.element.onended = old.element.onerror = null
      old.element.pause(); old.element.removeAttribute('src'); old.element.load()
    }
  }
  useEffect(() => () => cleanup(), [media, mediaPath, legacyUrl])
  const playable = !!(media?.clips.length || legacyUrl)
  const play = (index: number, all: boolean, position = ranges[index]?.start ?? 0) => {
    const range = ranges[index]
    if (!range || !playable) return
    cleanup()
    const sequence = generation.current, multi = (media?.clips.length ?? 0) > 1
    const clip = media?.clips[multi ? index : 0]
    const element = new Audio(), start = multi ? position - range.start : position, end = multi ? range.end - range.start : all ? total : range.end
    lease.current = { element, index, all, sequence }
    const valid = () => lease.current?.element === element && generation.current === sequence
    const fail = () => { if (valid()) { cleanup(); setState({ status: 'error', index, elapsed: position }) } }
    const finish = () => {
      if (!valid()) return
      if (multi && all && index + 1 < ranges.length) play(index + 1, true)
      else { cleanup(); setState({ status: 'idle', index: !multi && all ? ranges.length - 1 : index, elapsed: !multi && all ? total : range.end }) }
    }
    element.preload = 'none'
    element.defaultPlaybackRate = rateRef.current
    element.onloadedmetadata = () => {
      if (!valid()) return
      const expected = clip ? clip.durationMillis / 1000 : total
      if (!Number.isFinite(element.duration) || Math.abs(element.duration - expected) > .25) { fail(); return }
      element.playbackRate = rateRef.current
      element.currentTime = start
    }
    element.ontimeupdate = () => {
      if (!valid()) return
      const elapsed = Math.min(!multi && all ? total : range.end, (multi ? range.start : 0) + element.currentTime)
      const active = !multi && all ? ranges.findIndex(row => row.end > elapsed) : index
      lease.current!.index = active < 0 ? ranges.length - 1 : active
      setState({ status: element.paused ? 'idle' : 'playing', index: lease.current!.index, elapsed })
    }
    element.onended = finish
    element.onerror = fail
    element.src = clip ? `${mediaPath}?ref=${encodeURIComponent(clip.mediaRef)}` : legacyUrl!
    setState({ status: 'loading', index, elapsed: position })
    void element.play().then(() => {
      if (!valid()) return
      setState(value => ({ ...value, status: 'playing' }))
      const tick = () => {
        if (!valid() || element.paused) return
        if (element.currentTime >= end) { finish(); return }
        frame.current = requestAnimationFrame(tick)
      }
      frame.current = requestAnimationFrame(tick)
    }, fail)
  }
  const pause = () => {
    const old = lease.current
    if (!old) return
    const elapsed = (media && media.clips.length > 1 ? ranges[old.index]!.start : 0) + old.element.currentTime
    cleanup(); setState({ status: 'idle', index: old.index, elapsed })
  }
  const toggle = (index: number, all = false) => {
    const old = lease.current
    if (old && (all || old.index === index)) { pause(); return }
    const value = current.current
    const resume = value.index === index && value.elapsed >= ranges[index]!.start && value.elapsed < ranges[index]!.end
    play(index, all, resume ? value.elapsed : undefined)
  }
  const seek = (position: number) => {
    const bounded = Math.max(0, Math.min(total, position)), index = ranges.findIndex(row => row.end > bounded)
    if (index < 0) { cleanup(); setState({ status: 'idle', index: ranges.length - 1, elapsed: total }); return }
    if (lease.current) play(index, true, bounded)
    else setState({ status: 'idle', index, elapsed: bounded })
  }
  return { ...state, rate, cycleRate: () => { const rates = [1, 1.25, 1.5, 2]; rateRef.current = rates[(rates.indexOf(rateRef.current) + 1) % rates.length]!; setRate(rateRef.current); if (lease.current) lease.current.element.playbackRate = rateRef.current }, total, playable, toggle, seek, toggleAll: () => toggle(state.elapsed >= total ? 0 : state.index ?? 0, true), stop: () => { cleanup(); setState({ status: 'idle', elapsed: 0 }) } }
}
