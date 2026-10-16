import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingDay, ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const targetId = 'item-1200'
const stamp = new Date(2026, 9, 14).getTime()
const day = (marked: boolean, pending = false): ArkmeRecordingDay => ({
  dateStamp: stamp, totalDurationMillis: 1442000, coverage: { state: 'ready', intervals: [] },
  transcript: { state: 'ready', message: '', processingCount: 0, totalDurationMillis: 1442000,
    items: Array.from({ length: 1442 }, (_, i): ArkmeRecordingWorkbenchItem => ({
      itemId: `item-${i}`, itemRef: `${marked ? 'old' : 'new'}-ref-${i}`, transcriptSource: 'system', sessionKey: 'session',
      startAtMillis: stamp + i * 1000, endAtMillis: stamp + (i + 1) * 1000,
      speakerKey: i === 1200 && marked ? 'person' : 'system', speakerNumber: 9396, speakerColorIndex: 1,
      speakerLabel: i === 1200 && marked ? '周鹏' : '说话人 9396', sameSpeakerItemCount: 1,
      isSelf: false, isBackground: false, text: `片段 ${i}`,
      ...(i === 1200 && marked ? { assignedSpeakerOptionKey: 'person' } : {}),
    })),
  },
  summary: { state: pending ? 'processing' : 'empty', items: [] }, timeline: { state: 'empty', items: [] },
})

// Rendering and editing 1,442 transcript rows can exceed the default 5s on shared CI runners.
describe('speaker update in a long recording transcript', { timeout: 15_000 }, () => {
  let renderer: ReactTestRenderer
  let initial: ArkmeRecordingDay, updated: ArkmeRecordingDay
  let reads: number, resolvePoll: (value: ArkmeRecordingDay) => void
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 14, 22))
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    initial = day(true); updated = day(false); reads = 0
    mocks.call.mockReset().mockImplementation(async (op, params) => {
      if (op === 'recordings.totals.index') return { items: [], nextOffset: null }
      if (op === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (op === 'recordings.summary-model-config') return { options: [] }
      if (op === 'recordings.speaker.cached-options') return null
      if (op === 'recordings.speaker.options') return []
      if (op === 'recordings.speaker.recommendation') return {}
      if (op === 'recordings.day') {
        reads++
        if (params.dateStamp !== stamp) return { ...updated, dateStamp: params.dateStamp }
        if (reads > 1) return await new Promise(resolve => { resolvePoll = resolve })
        return initial
      }
      if (op === 'recordings.speaker.unassign-item') return { scope: 'item', affectedCount: 1, day: updated }
      throw new Error(op)
    })
  })
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    vi.unstubAllGlobals(); vi.useRealTimers()
  })
  const row = (id = targetId) => renderer.root.findByProps({ 'data-recording-transcript-item': id })
  const label = () => row().findAllByType('button')[0]!.props['aria-label']
  const feedback = () => renderer.root.findAllByProps({ 'data-recording-speaker-feedback': true })
  const open = async (id = targetId) => {
    await act(async () => {
      row(id).findAllByType('button')[0]!.props.onClick({ stopPropagation() {}, currentTarget: {
        getBoundingClientRect: () => ({ left: 24, right: 104, top: 700, bottom: 724 }),
      } }); await tick()
    })
  }
  const mount = async () => {
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />); await tick() })
  }
  const remove = async () => {
    await act(async () => { renderer.root.findByProps({ 'aria-label': '取消说话人标记' }).props.onClick(); await tick() })
  }

  it('keeps the restored identity visible after the short feedback ends, until another fragment is edited', async () => {
    await mount(); await open(); await remove()
    expect(label()).toBe('编辑说话人 说话人 9396')
    expect(row().findAllByType('button')[0]!.props['data-recording-speaker-repeated']).toBeUndefined()
    expect(row().props['data-recording-speaker-updated']).toBe(true)
    expect(feedback()[0]!.children.join('')).toContain('已取消标记，恢复为「说话人 9396」')
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(feedback()).toHaveLength(0)
    expect(row().props['data-recording-speaker-updated']).toBeUndefined()
    expect(row().findAllByType('button')[0]!.props['data-recording-speaker-repeated']).toBeUndefined()
    await open('item-1201')
    expect(row().findAllByType('button')[0]!.props['data-recording-speaker-repeated']).toBe(true)
  })

  it('ignores an older poll arriving after removal, then accepts a fresh poll', async () => {
    initial = day(true, true); updated = day(false, true)
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await tick() })
    expect(reads).toBe(2)
    await open(); await remove()
    expect(label()).toBe('编辑说话人 说话人 9396')
    await act(async () => { resolvePoll(initial); await tick() })
    expect(label()).toBe('编辑说话人 说话人 9396')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await tick() })
    expect(reads).toBe(3)
    await act(async () => { resolvePoll(day(false)); await tick() })
    expect(label()).toBe('编辑说话人 说话人 9396')
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); await tick() })
    expect(reads).toBe(3)
  })

  it('does not claim success or hide the editor on a failed removal', async () => {
    const original = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((op, ...args) => op === 'recordings.speaker.unassign-item'
      ? Promise.reject(new Error('取消失败')) : original(op, ...args))
    await mount(); await open(); await remove()
    expect(label()).toBe('编辑说话人 周鹏')
    expect(feedback()).toHaveLength(0)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('取消失败')
  })

  it('clears the feedback and pinned identity when changing recording dates', async () => {
    await mount(); await open(); await remove()
    await act(async () => { renderer.root.findByProps({ 'aria-label': '10月13日' }).props.onClick(); await tick() })
    expect(feedback()).toHaveLength(0)
    expect(row().findAllByType('button')[0]!.props['data-recording-speaker-repeated']).toBe(true)
  })
})
