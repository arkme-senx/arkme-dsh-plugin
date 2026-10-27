// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
import { RecordingComparisonChoices, RecordingComparisonMenu } from '../src/client/recordings/RecordingComparisonMenu.js'
import { RECORDING_STRATEGIES } from '../src/recording-strategy-contract.js'
let view: ReactTestRenderer
const day = new Date(2026, 9, 14).getTime(), onResult = vi.fn(), onDoubao = vi.fn()
let expired = false, existing = false
const read = async (_op: string, p: any) => {
  if (p.action === 'recordings') return { items: [{ sessionRef: 'one', startAtMillis: day, endAtMillis: day + 60_000 }, { sessionRef: 'two', startAtMillis: day + 60_000, endAtMillis: day + 120_000 }] }
  if (p.action === 'sources') return { items: [{ sourceRef: `${p.sessionRef}-source`, fileName: `${p.sessionRef}.wav`, startAtMillis: 0 }] }
  if (p.action === 'options') return { strategies: RECORDING_STRATEGIES, officialStrategy: p.sourceRef.startsWith('one') ? 'baseline-sd-asr/20261026' : 'system-sd-asr/v1', officialComplete: true, officialFailed: false, canStart: !expired, expiresAtMillis: expired ? day : Date.now() + 1_000, results: existing ? [{ strategy: 'system-sd-asr/v1', complete: true, failed: false }] : [] }
  return { accepted: true }
}
const mount = () => act(async () => { view = create(<RecordingComparisonChoices dateStamp={day} onResult={onResult} onDoubao={onDoubao} />) })
const content = () => JSON.stringify(view.toJSON())
const choice = (text: string) => view.root.findAllByType('button').find(row => row.findAllByType('span').some(span => span.children.join('') === text))!
beforeEach(() => { expired = existing = false; onResult.mockReset(); onDoubao.mockReset(); mock.call.mockReset().mockImplementation(read) })
afterEach(async () => { await act(async () => view?.unmount()); vi.useRealTimers() })
it('hover/click opens all choices without starting Doubao or any strategy', async () => {
  await act(async () => { view = create(<RecordingComparisonMenu dateStamp={day} disabled={false} busy={false} mediaPath="/media" onDoubao={onDoubao} onOpenResult={() => {}} />) })
  await act(async () => view.root.findByProps({ 'aria-label': '转写对比' }).props.onMouseEnter())
  expect(choice('默认版')).toBeDefined(); expect(choice('测试版v1')).toBeDefined(); expect(choice('豆包')).toBeDefined()
  expect(mock.call.mock.calls.every(([op]) => op === 'recordings.strategies')).toBe(true)
  expect(onDoubao).not.toHaveBeenCalled()
  expect(content()).toContain('此音频正式结果：默认版')
  expect(mock.call.mock.calls.some(([, p]) => p.action === 'preference')).toBe(false)
})
it('selecting a different recording reflects its real official strategy and opens that source without submitting', async () => {
  await mount()
  await act(async () => view.root.findByProps({ 'aria-label': '选择对比录音' }).props.onChange({ target: { value: 'two' } }))
  expect(content()).toContain('此音频正式结果：测试版v1')
  await act(async () => choice('默认版').props.onClick())
  expect(mock.call.mock.calls.every(([op]) => !op.endsWith('.start'))).toBe(true)
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'two-source' }))
})
it('does not start existing results, and keeps them accessible after original expiry', async () => {
  expired = existing = true
  await mount()
  expect(choice('测试版v1').props.disabled).toBe(false)
  await act(async () => choice('测试版v1').props.onClick())
  expect(mock.call.mock.calls.every(([op]) => !op.endsWith('.start'))).toBe(true)
  expect(onResult).toHaveBeenCalledOnce()
})
it('disables new processing on expired originals without disabling day-level Doubao enhancement', async () => {
  expired = true; await mount()
  expect(choice('测试版v1').props.disabled).toBe(true)
  expect(choice('默认版').props.disabled).toBe(false)
  await act(async () => choice('豆包').props.onClick())
  expect(onDoubao).toHaveBeenCalledOnce(); expect(onResult).not.toHaveBeenCalled()
})
it('expires new-processing controls while the menu is open', async () => {
  vi.useFakeTimers(); await mount()
  expect(choice('测试版v1').props.disabled).toBe(false)
  await act(async () => vi.advanceTimersByTimeAsync(1001))
  expect(choice('测试版v1').props.disabled).toBe(true)
})
it('opens a not-yet-generated strategy as a read-only result view', async () => {
  await mount(); await act(async () => choice('测试版v1').props.onClick())
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'one-source' }))
  expect(mock.call.mock.calls.every(([op]) => !op.endsWith('.start'))).toBe(true)
})
it('ignores a late options response for the previous source', async () => {
  let resolve!: (value: unknown) => void
  mock.call.mockImplementation(async (op, p) => p.action === 'options' && p.sourceRef === 'one-source' ? new Promise(yes => { resolve = yes }) : read(op, p))
  await mount()
  const signal = mock.call.mock.calls.find(([, p]) => p.action === 'options')![2] as AbortSignal
  await act(async () => view.root.findByProps({ 'aria-label': '选择对比录音' }).props.onChange({ target: { value: 'two' } }))
  await act(async () => resolve(await read('', { action: 'options', sourceRef: 'one-source' })))
  expect(signal.aborted).toBe(true); expect(content()).toContain('此音频正式结果：测试版v1')
})
it('retries metadata failures without starting work or claiming a default strategy', async () => {
  mock.call.mockRejectedValueOnce(new Error('暂时离线')); await mount()
  expect(content()).toContain('暂未读取'); expect(content()).toContain('暂时离线')
  await act(async () => view.root.findAllByType('button').find(row => row.children.join('') === '重试')!.props.onClick())
  expect(content()).toContain('此音频正式结果：默认版')
})
