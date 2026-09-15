// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: async (operation: string, params: { dateStamp?: number } = {}) => {
    if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 0, days: [] }
    if (operation === 'recordings.summary-model-config') return { options: [] }
    if (operation === 'recordings.day') return {
      dateStamp: params.dateStamp, totalDurationMillis: 0,
      transcript: { state: 'empty', message: '', totalDurationMillis: 0, processingCount: 0, items: [] },
      summary: { state: 'empty', message: '', items: [] },
      timeline: { state: 'empty', message: '', items: [] },
    }
    throw new Error(`Unexpected operation: ${operation}`)
  },
}))

let host: HTMLDivElement
let root: Root
let reducedMotion: boolean
let motionChange: (() => void) | undefined

function button(label: string) {
  const value = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(element => (element.getAttribute('aria-label') ?? element.textContent) === label)
  expect(value, `button: ${label}`).toBeDefined()
  return value!
}
async function click(label: string) {
  await act(async () => { button(label).click() })
}
function advance(ms: number) { act(() => { vi.advanceTimersByTime(ms) }) }
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]') }
function step() { return document.querySelector('[data-recording-guide-step]')?.textContent }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 11, 12))
  reducedMotion = false
  motionChange = undefined
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return reducedMotion },
    addEventListener: (_event: string, listener: () => void) => { motionChange = listener },
    removeEventListener: () => { motionChange = undefined },
  }))
  arkmeUi.showRecordings()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('mobile recording guide', () => {
  it('opens next to import and preserves the selected calendar date on close', async () => {
    await click('9月10日')
    const trigger = button('全天候录音')
    expect(trigger.previousElementSibling?.textContent).toBe('导入历史音频')
    trigger.focus()
    await click('全天候录音')
    expect(dialog()?.textContent).toContain('在手机上开启全天候录音')
    expect(dialog()?.textContent).toContain('请在手机上开启')
    await click('我知道了')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(button('9月10日').getAttribute('aria-pressed')).toBe('true')
  })

  it('demonstrates entry, microphone activation and recording before looping', async () => {
    await click('全天候录音')
    expect(step()).toContain('在快记页点击「录音」')
    advance(2080)
    expect(document.querySelector('[data-recording-guide-phase]')?.getAttribute('data-recording-guide-phase')).toBe('enter')
    advance(2080)
    expect(step()).toContain('点击底部麦克风，开启录音')
    advance(2080)
    expect(step()).toContain('看到「全天候录音中」，即已开启')
    advance(1040)
    expect(document.querySelector('[data-recording-guide-clock]')?.textContent).toBe('已录 00:00:01')
    advance(2880)
    expect(step()).toContain('在快记页点击「录音」')
    expect(document.querySelector('[data-recording-guide-phase]')?.getAttribute('data-recording-guide-phase')).toBe('swipe')
  })

  it('freezes the shared animation clock while paused and resumes from there', async () => {
    await click('全天候录音')
    advance(7200)
    await click('暂停')
    const snapshot = document.querySelector('[data-recording-guide-demo]')?.outerHTML
    advance(15000)
    expect(document.querySelector('[data-recording-guide-demo]')?.outerHTML).toBe(snapshot)
    await click('继续')
    advance(1040)
    expect(document.querySelector('[data-recording-guide-clock]')?.textContent).toBe('已录 00:00:02')
    await click('重新播放')
    expect(step()).toContain('在快记页点击「录音」')
    expect(button('暂停')).toBeDefined()
  })

  it('restarts playback from the beginning when replaying while paused or reopening', async () => {
    const baselineTimers = vi.getTimerCount()
    await click('全天候录音')
    advance(5000)
    await click('暂停')
    await click('重新播放')
    expect(step()).toContain('在快记页点击「录音」')
    advance(4200)
    expect(step()).toContain('点击底部麦克风，开启录音')
    await click('关闭录音引导')
    advance(0) // Flush jsdom's selectionchange queued by focus restoration.
    expect(vi.getTimerCount()).toBe(baselineTimers)
    await click('全天候录音')
    expect(step()).toContain('在快记页点击「录音」')
    await act(async () => { root.render(null) })
    advance(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('traps keyboard focus and closes on Escape with focus restored', async () => {
    const trigger = button('全天候录音')
    trigger.focus()
    await click('全天候录音')
    const first = button('关闭录音引导')
    const last = button('我知道了')
    expect(document.activeElement).toBe(first)
    act(() => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(last)
    act(() => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(first)
    act(() => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses only direct backdrop presses', async () => {
    await click('全天候录音')
    act(() => { dialog()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(dialog()).not.toBeNull()
    act(() => { dialog()!.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(dialog()).toBeNull()
  })

  it('shows all three static illustrations instead of playback for reduced motion', async () => {
    reducedMotion = true
    const baselineTimers = vi.getTimerCount()
    await click('全天候录音')
    expect(document.querySelectorAll('[data-recording-guide-static-step]')).toHaveLength(3)
    expect(dialog()?.textContent).toContain('点击底部麦克风，开启录音')
    expect(dialog()?.textContent).toContain('看到「全天候录音中」，即已开启')
    expect([...dialog()!.querySelectorAll('button')].some(element => element.textContent === '暂停')).toBe(false)
    advance(0) // Initial focus also queues selectionchange in jsdom.
    expect(vi.getTimerCount()).toBe(baselineTimers)
  })

  it('switches to static guidance when reduced motion changes during playback', async () => {
    const baselineTimers = vi.getTimerCount()
    await click('全天候录音')
    advance(5000)
    act(() => { reducedMotion = true; motionChange?.() })
    expect(document.querySelectorAll('[data-recording-guide-static-step]')).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(baselineTimers)
  })

  it('closes the portaled guide when the recording surface becomes inactive', async () => {
    await click('全天候录音')
    await act(async () => { root.render(<ArkmeRecordingSurface active={false} onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    expect(dialog()).toBeNull()
    await act(async () => { root.render(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
    expect(dialog()).toBeNull()
  })
})
