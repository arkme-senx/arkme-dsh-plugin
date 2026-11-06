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
  storage: { status: 'ready', totalBytes: 1000000, usedBytes: 250000, remainingBytes: 750000, remainingSeconds: 60, generation: 1 }, updatedAtMillis: 1, job: null, recordingCount: 1,
  recordings: [{ id: 'volume.1', sessionId: 1, startAtMillis: null, durationMillis: 12000, complete: true, cached: true }] }] })
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.join('') === label)!
const datetime = () => renderer!.root.findAllByType('input').find(node => node.props.type === 'datetime-local')!
async function render(value = snapshot()) {
  mocks.call.mockImplementation(async operation => operation === 'recorders.local.prepare' ? { ref: 'b'.repeat(64), fileName: 'test.wav', durationMillis: 12000, size: 384044 } : value)
  await act(async () => { renderer = create(<LocalRecorderPanel mediaPath="/arkme-self/api/media" onClose={() => {}} onShowImports={() => {}} />) })
}
beforeEach(() => { vi.useFakeTimers(); mocks.call.mockReset() })
describe('native-style local recorder workspace', () => {
  it('opens cached state without opening hardware; discovery and sync require clicks', async () => {
    await render(); expect(mocks.call.mock.calls.map(row => row[0])).toEqual(['recorders.local.snapshot'])
    await act(async () => { button('查找设备').props.onClick() }); expect(mocks.call).toHaveBeenCalledWith('recorders.local.discover', {}, expect.any(AbortSignal))
    await act(async () => { button('同步新增录音').props.onClick() }); expect(mocks.call).toHaveBeenCalledWith('recorders.local.sync', { deviceId: 'a'.repeat(64) }, expect.any(AbortSignal))
  })
  it('requires a real start time and explicit confirmation before import; keeps media account-bound', async () => {
    await render(); await act(async () => { button('导入即我').props.onClick() })
    expect(button('确认导入').props.disabled).toBe(true)
    expect(mocks.call.mock.calls.some(row => row[0] === 'recorders.local.import')).toBe(false)
    await act(async () => { datetime().props.onChange({ target: { value: '2026-01-01T12:00' } }) }); expect(button('确认导入').props.disabled).toBe(false)
    await act(async () => { button('播放').props.onClick() }); expect(renderer!.root.findByType('audio').props.src).toBe(`/arkme-self/api/recording/local-audio?ref=${'b'.repeat(64)}`)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('/Users/')
  })
  it('keeps partial recordings playable but prevents incomplete import', async () => {
    const value = snapshot(); value.devices[0]!.recordings[0]!.complete = false; await render(value)
    expect(button('播放').props.disabled).toBe(false); expect(button('导入即我').props.disabled).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain('待完整同步')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('未完整关闭')
  })
  it('preserves device start time down to milliseconds in the import form', async () => {
    const value = snapshot(); value.devices[0]!.recordings[0]!.startAtMillis = 1700000000123; await render(value)
    await act(async () => { button('导入即我').props.onClick() }); expect(new Date(datetime().props.value).getTime()).toBe(1700000000123)
  })
  it('displays real metadata and metrics, and supports keyboard resizing', async () => {
    const value = snapshot(), device = value.devices[0]!
    device.recordings[0]!.info = { audioBytes: 9100000, cachedDurationMillis: 12000, endAtMillis: null, batteryStartMV: 4167, batteryEndMV: null, firmwareVersion: 0x02011c, gainStartDb: 4, gainChanges: 0, vadEnabled: false, vadThreshold: 200, stopReason: 3, blockCount: 36, crcVerified: true }
    device.job = { state: 'syncing', blocks: 37, detail: '正在读取', transfer: { phase: 'reading', startedAtMillis: Date.now(), elapsedMillis: 1000, readMillis: 700, readBytes: 9300000, scannedBlocks: 37, totalBlocks: 2039 } }
    await render(value)
    const text = JSON.stringify(renderer!.toJSON()); expect(text).toContain('4.167 V'); expect(text).toContain('V2.1.28'); expect(text).toContain('9.1 MB'); expect(text).toContain('存储已满'); expect(text).toContain('未启用')
    const separator = renderer!.root.findByProps({ role: 'separator' }); expect(separator.props['aria-valuenow']).toBe(320)
    await act(async () => separator.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })); expect(separator.props['aria-valuenow']).toBe(336)
  })
})
