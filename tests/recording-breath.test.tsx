// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { recordingBreathStyle, useRecordingBreathStyle } from '../src/client/recordings/recording-breath.js'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'

// The test runner omits CSS; verify the real packaged style installer explicitly.
vi.mock('../src/client/recordings/recording-breath.css?inline', async () => ({ default: (await import('node:fs')).readFileSync(`${process.cwd()}/src/client/recordings/recording-breath.css`, 'utf8') }))

it('aligns late-mounted indicators to the same two-second recording cycle', () => {
  expect(recordingBreathStyle(10000, 13500)).toEqual({ '--arkme-recording-breath-delay': '-1500ms' })
  expect(recordingBreathStyle(10000, 15500)).toEqual(recordingBreathStyle(10000, 13500))
  for (const startedAt of [0, Number.NaN, 20000]) {
    expect(recordingBreathStyle(startedAt, 13500)).toEqual({ '--arkme-recording-breath-delay': '0ms' })
  }
})

it('keeps delay stable during timer updates and recalculates on a fresh recording', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'), root = createRoot(host)
  const now = vi.spyOn(Date, 'now').mockReturnValue(13500)
  function Indicator({ active, startedAt = 10000 }: { active: boolean; startedAt?: number }) {
    return <span style={useRecordingBreathStyle(active, startedAt)} />
  }
  const delay = () => (host.firstElementChild as HTMLElement).style.getPropertyValue('--arkme-recording-breath-delay')
  try {
    act(() => root.render(<Indicator active />)); expect(delay()).toBe('-1500ms')
    now.mockReturnValue(14200)
    act(() => root.render(<Indicator active />)); expect(delay()).toBe('-1500ms')
    act(() => root.render(<Indicator active={false} />)); expect(delay()).toBe('')
    act(() => root.render(<Indicator active startedAt={14000} />)); expect(delay()).toBe('-200ms')
  } finally { act(() => root.unmount()); now.mockRestore() }
})

it('ships shared visual-only animation with reduced-motion support', () => {
  const dispose = installArkmeRedesignStyles()
  try {
    const css = document.head.textContent ?? ''
    expect(css).toContain('arkme-recording-dot-breathe')
    expect(css).toContain('2s ease-in-out infinite')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain('animation: none !important')
    expect(css).toContain('pointer-events: none')
  } finally { dispose() }
})

it('resynchronizes when the OS motion preference changes and unsubscribes on unmount', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const listeners = new Set<() => void>()
  const media = { matches: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }
  vi.stubGlobal('matchMedia', () => media)
  const now = vi.spyOn(Date, 'now').mockReturnValue(13500)
  const host = document.createElement('div'), root = createRoot(host)
  function Indicator() { return <span style={useRecordingBreathStyle(true, 10000)} /> }
  const delay = () => (host.firstElementChild as HTMLElement).style.getPropertyValue('--arkme-recording-breath-delay')
  try {
    act(() => root.render(<Indicator />)); expect(delay()).toBe('-1500ms')
    now.mockReturnValue(14200)
    act(() => { media.matches = true; listeners.forEach(fn => fn()) })
    expect(delay()).toBe('-200ms')
    now.mockReturnValue(14700)
    act(() => { media.matches = false; listeners.forEach(fn => fn()) })
    expect(delay()).toBe('-700ms')
  } finally {
    act(() => root.unmount()); now.mockRestore(); vi.unstubAllGlobals()
  }
  expect(listeners.size).toBe(0)
})
