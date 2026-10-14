// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn(), local: { accountKey: 'test:42', phase: 'idle' } as { accountKey?: string; phase: string; recordingId?: string; stoppedRecordingIds?: readonly string[]; elapsedMillis?: number }, listeners: new Set<() => void>() }))
const { call } = mock
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/recordings/direct-recording-store.js', () => ({ directRecordingStore: {
  getSnapshot: () => mock.local, subscribe: (listener: () => void) => { mock.listeners.add(listener); return () => { mock.listeners.delete(listener) } },
} }))
import { ArkmeRecordingPresence } from '../src/client/recordings/ArkmeRecordingPresence.js'
const item = { recordingId: 'r1', deviceId: '42', deviceName: '我的手机', clientType: 'mobile', platform: 'ios', recordingMode: 'all_day', state: 'recording', elapsedMillis: 60000, durationAnchorAt: 100000, expiresAt: 130000, visibleUntil: 190000, freshness: 'fresh', startedAt: 40000 }
const snapshot = { items: [item], serverNow: 100000, pollIntervalMillis: 10000 }
let renderer: ReactTestRenderer
const text = () => JSON.stringify(renderer.toJSON())
const mount = async (accountKey = 'test:42') => { await act(async () => { renderer = create(<ArkmeRecordingPresence accountKey={accountKey} active />) }) }
beforeEach(() => { mock.local = { accountKey: 'test:42', phase: 'idle' }; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] }); call.mockReset(); call.mockResolvedValue(snapshot); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }) })
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); mock.listeners.clear(); vi.useRealTimers() })
const local = async (update: Partial<typeof mock.local>) => { await act(async () => { mock.local = { ...mock.local, ...update }; mock.listeners.forEach(listener => listener()) }) }
describe('device recording list', () => {
  it('renders nothing while loading or empty, but keeps polling and appears when a device starts', async () => {
    let resolve!: (value: unknown) => void
    call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await mount()
    expect(renderer.toJSON()).toBeNull()
    await act(async () => { resolve({ ...snapshot, items: [] }) })
    expect(renderer.toJSON()).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(text()).toContain('我的手机')
    call.mockResolvedValue({ ...snapshot, items: [{ ...item, state: 'stopped' }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(renderer.toJSON()).toBeNull()
  })
  it('hides an initial sync failure and automatically recovers without an empty error card', async () => {
    call.mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect(renderer.toJSON()).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(text()).toContain('我的手机')
  })
  it.each([['paused', '已暂停'], ['interrupted', '已中断'], ['error', '录音异常']])('keeps actionable %s device states visible', async (state, label) => {
    call.mockResolvedValue({ ...snapshot, items: [{ ...item, state }] })
    await mount()
    expect(text()).toContain('我的手机')
    expect(text()).toContain(label)
  })
  it('polls and ticks, retains rows on failure, freezes stale time and expires visibility', async () => {
    await mount()
    expect(text()).toContain('我的手机')
    expect(text()).toContain('01:00')
    call.mockRejectedValue(new Error('offline'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(call).toHaveBeenCalledTimes(2)
    expect(text()).toContain('01:10')
    expect(text()).toContain('同步暂时失败')
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(text()).toContain('状态待确认')
    expect(text()).toContain('01:00')
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(renderer.toJSON()).toBeNull()
  })
  it('pauses while hidden and immediately refreshes on visibility recovery', async () => {
    await mount()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(30000) })
    expect(call).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(call).toHaveBeenCalledTimes(2)
  })
  it('clears old account rows immediately and ignores a late old response', async () => {
    let resolveOld!: (v: unknown) => void
    call.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    await mount()
    call.mockResolvedValue({ ...snapshot, items: [] })
    await act(async () => { renderer.update(<ArkmeRecordingPresence accountKey="prod:43" active />) })
    await act(async () => { resolveOld(snapshot) })
    expect(renderer.toJSON()).toBeNull()
  })
  it('hides disabled capability, avoids repeated polls, and retries when focus returns', async () => {
    call.mockRejectedValue({ body: { code: 'arkme-code-1201' } })
    await mount()
    expect(renderer.toJSON()).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(call).toHaveBeenCalledTimes(1)
    call.mockResolvedValue(snapshot)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(text()).toContain('我的手机')
  })
  it('omits the current local capture and suppresses stopped IDs across stale polls and remounts', async () => {
    const sameDevice = { ...item, deviceName: '这台电脑', deviceId: '42', clientType: 'desktop', recordingMode: 'manual' }
    call.mockResolvedValue({ ...snapshot, items: [sameDevice, { ...item, recordingId: 'r2', deviceId: '43' }] })
    await local({ phase: 'recording', recordingId: 'r1', elapsedMillis: 65000 })
    await mount()
    expect(renderer.root.findAllByType('li')).toHaveLength(1)
    expect(text()).not.toContain('这台电脑')
    expect(text()).toContain('我的手机')
    await local({ phase: 'saving', stoppedRecordingIds: ['r1'] })
    expect(renderer.root.findAllByType('li')).toHaveLength(1)
    await local({ phase: 'idle', recordingId: undefined })
    expect(renderer.root.findAllByType('li')).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(renderer.root.findAllByType('li')).toHaveLength(1)
    await act(async () => renderer.unmount())
    await mount()
    expect(renderer.root.findAllByType('li')).toHaveLength(1)
  })
  it('leaves no card when only the current local capture remains', async () => {
    await local({ phase: 'recording', recordingId: 'r1', elapsedMillis: 65000 })
    await mount()
    expect(renderer.toJSON()).toBeNull()
  })
  it('never filters a remote row using another account local recording', async () => {
    await local({ accountKey: 'test:43', phase: 'recording', recordingId: 'r1', stoppedRecordingIds: ['r1'] })
    await mount('test:42')
    expect(renderer.root.findAllByType('li')).toHaveLength(1)
    expect(text()).toContain('我的手机')
  })
  it('keeps independent devices and removes only the one that stopped', async () => {
    call.mockResolvedValueOnce({ ...snapshot, items: [item, { ...item, recordingId: 'r2', deviceName: '工作电脑', deviceId: '43', state: 'paused' }] })
    await mount()
    expect(text()).toContain('我的手机')
    expect(text()).toContain('工作电脑')
    expect(text()).toContain('已暂停')
    call.mockResolvedValue({ ...snapshot, items: [{ ...item, recordingId: 'r2', deviceName: '工作电脑', deviceId: '43', state: 'paused' }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(text()).not.toContain('我的手机')
    expect(text()).toContain('工作电脑')
  })
  it('bounds a hung request, avoids overlapping polls and ignores its late response', async () => {
    let resolveLate!: (v: unknown) => void
    call.mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve }))
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(call).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(renderer.toJSON()).toBeNull()
    call.mockResolvedValue({ ...snapshot, items: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(call).toHaveBeenCalledTimes(2)
    await act(async () => { resolveLate(snapshot) })
    expect(text()).not.toContain('我的手机')
  })
  it('clears rendered rows when the account changes before a new response arrives', async () => {
    await mount()
    call.mockReturnValue(new Promise(() => {}))
    await act(async () => renderer.update(<ArkmeRecordingPresence accountKey="prod:43" active />))
    expect(renderer.toJSON()).toBeNull()
  })
  it('does not query while inactive and refreshes on return', async () => {
    await act(async () => { renderer = create(<ArkmeRecordingPresence accountKey="test:42" active={false} />) })
    expect(call).not.toHaveBeenCalled()
    await act(async () => renderer.update(<ArkmeRecordingPresence accountKey="test:42" active />))
    expect(text()).toContain('我的手机')
  })
})
