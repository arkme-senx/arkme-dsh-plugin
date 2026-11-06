// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { LocalRecorderPanel } from '../src/client/recordings/LocalRecorderEntry.js'
import type { LocalRecorderSnapshot } from '../src/local-recorder/contract.js'

let renderer: ReactTestRenderer | undefined
afterEach(async () => { await act(async () => renderer?.unmount()); vi.useRealTimers() })
const snapshot = (): LocalRecorderSnapshot => ({ supported: true, devices: [{ id: 'a'.repeat(64), name: 'Arkme Recorder', serialNumber: 'TEST', connected: true,
  storage: { status: 'ready', totalBytes: 1000000, usedBytes: 250000, remainingBytes: 750000, remainingSeconds: 60, generation: 1 },
  updatedAtMillis: 1, job: null, recordingCount: 1,
  recordings: [{ id: 'volume.1', sessionId: 1, startAtMillis: null, durationMillis: 12000, complete: true, cached: true }] }] })
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.join('') === label)!
async function render(value = snapshot()) {
  mocks.call.mockImplementation(async operation => operation === 'recorders.local.prepare'
    ? { ref: 'b'.repeat(64), fileName: 'test.wav', durationMillis: 12000, size: 384044 }
    : value)
  await act(async () => { renderer = create(<LocalRecorderPanel mediaPath="/arkme-self/api/media" onClose={() => {}} onShowImports={() => {}} />) })
}
beforeEach(() => { vi.useFakeTimers(); mocks.call.mockReset() })
describe('local recorder UI', () => {
  it('opens cached state without opening hardware; discovery and sync require actual clicks', async () => {
    await render()
    expect(mocks.call.mock.calls.map(row => row[0])).toEqual(['recorders.local.snapshot'])
    await act(async () => { button('查找设备').props.onClick() })
    expect(mocks.call).toHaveBeenCalledWith('recorders.local.discover', {}, expect.any(AbortSignal))
    await act(async () => { button('同步新增录音').props.onClick() })
    expect(mocks.call).toHaveBeenCalledWith('recorders.local.sync', { deviceId: 'a'.repeat(64) }, expect.any(AbortSignal))
  })
  it('requires a real start time before import and exposes account-bound audio only', async () => {
    await render()
    await act(async () => { renderer!.root.findAllByType('button').find(node => node.props['aria-pressed'] === false)?.props.onClick() })
    expect(button('导入即我').props.disabled).toBe(true)
    await act(async () => { renderer!.root.findByType('input').props.onChange({ target: { value: '2026-01-01T12:00' } }) })
    expect(button('导入即我').props.disabled).toBe(false)
    await act(async () => { button('播放').props.onClick() })
    expect(renderer!.root.findByType('audio').props.src).toBe(`/arkme-self/api/recording/local-audio?ref=${'b'.repeat(64)}`)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('/Users/')
  })
  it('keeps partial recordings playable but prevents incomplete import', async () => {
    const value = snapshot(); value.devices[0]!.recordings[0]!.complete = false
    await render(value)
    await act(async () => { renderer!.root.findAllByType('button').find(node => node.props['aria-pressed'] === false)?.props.onClick() })
    expect(button('播放').props.disabled).toBe(false)
    expect(button('导入即我').props.disabled).toBe(true)
  })
  it('preserves device start time down to milliseconds in the import form', async () => {
    const value = snapshot(); value.devices[0]!.recordings[0]!.startAtMillis = 1700000000123
    await render(value)
    await act(async () => { renderer!.root.findAllByType('button').find(node => node.props['aria-pressed'] === false)?.props.onClick() })
    expect(new Date(renderer!.root.findByType('input').props.value).getTime()).toBe(1700000000123)
  })
})
