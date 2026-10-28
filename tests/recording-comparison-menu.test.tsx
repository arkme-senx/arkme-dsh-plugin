// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
import { RecordingComparisonChoices, RecordingComparisonMenu } from '../src/client/recordings/RecordingComparisonMenu.js'
let view: ReactTestRenderer
const day = new Date(2026, 9, 14).getTime(), onResult = vi.fn(), onDoubao = vi.fn()
const choice = (text: string) => view.root.findAllByType('button').find(row => row.findAllByType('span').some(span => span.children.join('') === text))!
beforeEach(() => { onResult.mockReset(); onDoubao.mockReset(); mock.call.mockReset() })
afterEach(async () => { await act(async () => view?.unmount()) })
it('opens day-level choices without selecting the first hour or reading any transcript', async () => {
  await act(async () => { view = create(<RecordingComparisonMenu dateStamp={day} disabled={false} busy={false} mediaPath="/media" onDoubao={onDoubao} onOpenResult={() => {}} />) })
  await act(async () => view.root.findByProps({ 'aria-label': '转写对比' }).props.onMouseEnter())
  expect(choice('默认版')).toBeDefined(); expect(choice('测试版v1')).toBeDefined(); expect(choice('豆包')).toBeDefined()
  expect(JSON.stringify(view.toJSON())).toContain('当天全部录音')
  expect(view.root.findAllByType('select')).toHaveLength(0)
  expect(mock.call).not.toHaveBeenCalled(); expect(onDoubao).not.toHaveBeenCalled()
})
it.each(['baseline-sd-asr/20261026', 'system-sd-asr/v1'] as const)('chooses %s for the full day without submitting processing', async strategy => {
  await act(async () => { view = create(<RecordingComparisonChoices dateStamp={day} onResult={onResult} onDoubao={onDoubao} />) })
  await act(async () => choice(strategy.startsWith('baseline') ? '默认版' : '测试版v1').props.onClick())
  expect(onResult).toHaveBeenCalledWith(strategy)
  expect(mock.call).not.toHaveBeenCalled(); expect(onDoubao).not.toHaveBeenCalled()
})
it('keeps Doubao as its existing day-level result view', async () => {
  await act(async () => { view = create(<RecordingComparisonChoices dateStamp={day} onResult={onResult} onDoubao={onDoubao} />) })
  await act(async () => choice('豆包').props.onClick())
  expect(onDoubao).toHaveBeenCalledOnce(); expect(onResult).not.toHaveBeenCalled(); expect(mock.call).not.toHaveBeenCalled()
})
