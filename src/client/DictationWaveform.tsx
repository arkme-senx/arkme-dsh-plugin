import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface DictationWaveformHandle { sample(level: number): void }
const SILENT = Array<number>(16).fill(3.75)
/** Flutter QuickInput mirrors its latest eight levels. This only paints the small SVG. */
export function dictationWaveHeights(levels: readonly number[]): number[] {
  const tail = levels.length ? levels.slice(-8).map(level => Math.max(.05, Math.min(1, Number.isFinite(level) ? level : .05))) : Array<number>(8).fill(.05)
  const padded = [...Array<number>(8 - tail.length).fill(.05), ...tail]
  return [...padded.slice().reverse(), ...padded].map(level => 3 + level * 15)
}

export const DictationWaveform = forwardRef<DictationWaveformHandle>(function DictationWaveform(_props, forwardedRef) {
  const svg = useRef<SVGSVGElement>(null)
  const levels = useRef<number[]>([])
  const target = useRef(SILENT.slice()), painted = useRef(SILENT.slice())
  const frame = useRef<number>()
  const live = useRef(false), reducedMotion = useRef(false)
  const paint = (heights: readonly number[]) => {
    svg.current?.querySelectorAll('line').forEach((line, index) => {
      const height = heights[index] ?? 3.75
      line.setAttribute('y1', String((18 - height) / 2))
      line.setAttribute('y2', String((18 + height) / 2))
    })
  }
  const tick = () => {
    frame.current = undefined
    if (!live.current) return
    let moving = false
    painted.current = painted.current.map((value, index) => {
      const destination = target.current[index] ?? 3.75
      if (Math.abs(destination - value) < .05) return destination
      moving = true; return value + (destination - value) * .35
    })
    paint(painted.current)
    if (moving) frame.current = requestAnimationFrame(tick)
  }
  useImperativeHandle(forwardedRef, () => ({ sample(level) {
    if (!live.current) return
    // The microphone gives PCM peak amplitude, while Flutter supplies normalized levels.
    // Normalize for display only; ASR/VAD keeps the original samples and thresholds.
    const normalized = Number.isFinite(level) ? Math.min(1, Math.sqrt(Math.max(0, level)) * 2.2) : .05
    levels.current = [...levels.current.slice(-7), normalized]
    target.current = dictationWaveHeights(levels.current)
    if (reducedMotion.current) { painted.current = target.current.slice(); paint(painted.current) }
    else if (frame.current === undefined) frame.current = requestAnimationFrame(tick)
  } }), [])
  useEffect(() => {
    live.current = true
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const update = () => {
      reducedMotion.current = preference?.matches ?? false
      if (reducedMotion.current && frame.current !== undefined) { cancelAnimationFrame(frame.current); frame.current = undefined; painted.current = target.current.slice(); paint(painted.current) }
    }
    update(); preference?.addEventListener?.('change', update)
    return () => { live.current = false; if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined; preference?.removeEventListener?.('change', update) }
  }, [])
  return <svg ref={svg} data-arkme-dictation-waveform viewBox="-1 0 26 18" width="26" height="18" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
    {SILENT.map((height, index) => <line key={index} x1={index * 24 / 15} x2={index * 24 / 15} y1={(18 - height) / 2} y2={(18 + height) / 2} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />)}
  </svg>
})
