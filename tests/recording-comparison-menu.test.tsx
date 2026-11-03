// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
import type { RecordingComparisonAvailability } from '../src/recording-strategy-contract.js'
import { RecordingComparisonChoices, RecordingComparisonMenu } from '../src/client/recordings/RecordingComparisonMenu.js'
let view: ReactTestRenderer
const day = new Date(2026, 9, 14).getTime(), onResult = vi.fn(), onDoubao = vi.fn()
let availability: RecordingComparisonAvailability
const choice = (text: string) => view.root.findAllByType('button').find(row => row.findAllByType('span').some(span => span.children.join('') === text))!
beforeEach(() => { availability = { strategy: 'available', doubao: 'available' }; onResult.mockReset(); onDoubao.mockReset(); mock.call.mockReset().mockImplementation(async (_operation, params) => {
  if (params.action === 'recordings') return { items: [{ sessionRef: 'owned' }] }
  if (params.action === 'sources') return { items: [{ sourceRef: 'source', fileName: 'old.wav', startAtMillis: day, availability }] }
  throw new Error('unexpected request')
}) })
afterEach(async () => { await act(async () => view?.unmount()) })
it('opens day-level choices without selecting the first hour or reading any transcript', async () => {
  await act(async () => { view = create(<RecordingComparisonMenu dateStamp={day} disabled={false} busy={false} mediaPath="/media" onDoubao={onDoubao} onOpenResult={() => {}} />) })
  await act(async () => view.root.findByProps({ 'aria-label': '转写对比' }).props.onMouseEnter())
  expect(choice('v2025-12')).toBeDefined(); expect(choice('v2026-10')).toBeUndefined(); expect(choice('豆包')).toBeDefined()
  expect(view.root.findByProps({ 'aria-label': '选择转写对比' }).findAllByType('button')).toHaveLength(2)
  expect(JSON.stringify(view.toJSON())).toContain('当天全部录音')
  expect(view.root.findAllByType('select')).toHaveLength(0)
  expect(mock.call.mock.calls.every(([, params]) => ['recordings', 'sources'].includes(params.action))).toBe(true); expect(onDoubao).not.toHaveBeenCalled()
})
it.each(['baseline-sd-asr/20261026'] as const)('chooses %s for the full day without submitting processing', async strategy => {
  await act(async () => { view = create(<RecordingComparisonChoices availability={{ strategy: 'available', doubao: 'available' }} dateStamp={day} onResult={onResult} onDoubao={onDoubao} />) })
  await act(async () => choice(strategy.startsWith('baseline') ? 'v2025-12' : 'v2026-10').props.onClick())
  expect(onResult).toHaveBeenCalledWith(strategy)
  expect(mock.call).not.toHaveBeenCalled(); expect(onDoubao).not.toHaveBeenCalled()
})
it('keeps Doubao as its existing day-level result view', async () => {
  await act(async () => { view = create(<RecordingComparisonChoices availability={{ strategy: 'available', doubao: 'available' }} dateStamp={day} onResult={onResult} onDoubao={onDoubao} />) })
  await act(async () => choice('豆包').props.onClick())
  expect(onDoubao).toHaveBeenCalledOnce(); expect(onResult).not.toHaveBeenCalled(); expect(mock.call).not.toHaveBeenCalled()
})

it.each([
  ['unavailable', 'unavailable', 0], ['available', 'unavailable', 1], ['unavailable', 'available', 1], ['available', 'available', 2],
] as const)('only offers usable choices: %s/%s', async (strategy, doubao, count) => {
  availability = { strategy, doubao }
  await act(async () => { view = create(<RecordingComparisonMenu dateStamp={day} disabled={false} busy={false} mediaPath="/media" onDoubao={onDoubao} onOpenResult={() => {}} />) })
  if (!count) { expect(view.root.findAllByType('button')).toHaveLength(0); return }
  await act(async () => view.root.findByProps({ 'aria-label': '转写对比' }).props.onMouseEnter())
  expect(view.root.findByProps({ 'aria-label': '选择转写对比' }).findAllByType('button')).toHaveLength(count)
  expect(!!choice('v2025-12')).toBe(strategy === 'available')
  expect(!!choice('豆包')).toBe(doubao === 'available')
  expect(mock.call.mock.calls.some(([, p]) => p.action === 'page' || p.action === 'start')).toBe(false)
})
it('keeps failures retryable without presenting an empty comparison page', async () => {
  mock.call.mockRejectedValue(new Error('temporary network failure'))
  await act(async () => { view = create(<RecordingComparisonMenu dateStamp={day} disabled={false} busy={false} mediaPath="/media" onDoubao={onDoubao} onOpenResult={() => {}} />) })
  const retry = view.root.findByProps({ 'aria-label': '重试读取转写对比状态' })
  expect(retry.props.disabled).toBe(false)
  expect(view.root.findAllByProps({ 'aria-label': '选择转写对比' })).toHaveLength(0)
})
it('can retry an unknown choice while the other comparison remains available', async () => {
  availability = { strategy: 'unknown', doubao: 'available' }
  await act(async () => { view = create(<RecordingComparisonMenu dateStamp={day} disabled={false} busy={false} mediaPath="/media" onDoubao={onDoubao} onOpenResult={() => {}} />) })
  await act(async () => view.root.findByProps({ 'aria-label': '转写对比' }).props.onMouseEnter())
  expect(choice('豆包')).toBeDefined(); expect(choice('v2025-12')).toBeUndefined()
  const retry = view.root.findByProps({ 'aria-label': '选择转写对比' }).findByProps({ 'aria-label': '重试读取转写对比状态' })
  availability = { strategy: 'available', doubao: 'available' }
  await act(async () => retry.props.onClick())
  await act(async () => view.root.findByProps({ 'aria-label': '转写对比' }).props.onMouseEnter())
  expect(choice('v2025-12')).toBeDefined(); expect(choice('豆包')).toBeDefined()
  expect(mock.call.mock.calls.every(([, params]) => ['recordings', 'sources'].includes(params.action))).toBe(true)
})
it('expires original-only availability while keeping retained Doubao results visible', async () => {
  vi.useFakeTimers()
  availability = { strategy: 'available', doubao: 'available', expiresAtMillis: Date.now() + 1000 }
  await act(async () => { view = create(<RecordingComparisonMenu dateStamp={day} disabled={false} busy={false} mediaPath="/media" onDoubao={onDoubao} onOpenResult={() => {}} />) })
  availability = { strategy: 'unavailable', doubao: 'available' }
  await act(async () => vi.advanceTimersByTimeAsync(1001))
  await act(async () => view.root.findByProps({ 'aria-label': '转写对比' }).props.onMouseEnter())
  expect(choice('v2025-12')).toBeUndefined(); expect(choice('豆包')).toBeDefined()
  vi.useRealTimers()
})
