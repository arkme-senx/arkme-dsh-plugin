// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => api)
import { RecordingProcessingSetting } from '../src/client/recordings/RecordingProcessingSetting.js'
let view: ReactTestRenderer
let strategy = 'system-sd-asr/v1'
const current = () => ({ userId: 42, strategy })
const select = () => view.root.findByType('select')
const render = async () => { await act(async () => { view = create(<RecordingProcessingSetting userId={42} active />) }) }
beforeEach(() => {
  strategy = 'system-sd-asr/v1'
  api.callArkme.mockReset().mockImplementation(async (op, params) => {
    if (op === 'recordings.strategies.preference.set') strategy = params.strategy
    return current()
  })
})
afterEach(async () => { await act(async () => view?.unmount()) })
it('renders one account setting and saves through the shared Host write owner', async () => {
  await render()
  expect(view.root.findAllByType('select')).toHaveLength(1)
  expect(select().props.value).toBe(strategy)
  await act(async () => select().props.onChange({ target: { value: 'baseline-sd-asr/20261026' } }))
  expect(api.callArkme).toHaveBeenCalledWith('recordings.strategies.preference.set', { strategy: 'baseline-sd-asr/20261026', expectedUserId: 42 })
  expect(select().props.value).toBe('baseline-sd-asr/20261026')
})
it('keeps a failed save visible and preserves the last confirmed setting', async () => {
  await render()
  api.callArkme.mockRejectedValueOnce(new Error('设置未保存'))
  await act(async () => select().props.onChange({ target: { value: 'baseline-sd-asr/20261026' } }))
  expect(select().props.value).toBe('system-sd-asr/v1')
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('设置未保存')
})
it('does not replace a confirmed write with an older focus read', async () => {
  await render()
  let resolve!: (value: unknown) => void
  api.callArkme.mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  await act(async () => window.dispatchEvent(new Event('focus')))
  await act(async () => select().props.onChange({ target: { value: 'baseline-sd-asr/20261026' } }))
  await act(async () => resolve({ userId: 42, strategy: 'system-sd-asr/v1' }))
  expect(select().props.value).toBe('baseline-sd-asr/20261026')
})
it('rejects a different account response instead of presenting its preference', async () => {
  api.callArkme.mockResolvedValue({ userId: 43, strategy: 'baseline-sd-asr/20261026' })
  await render()
  expect(select().props.disabled).toBe(true)
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('无法确认当前账号')
})
it('refreshes the saved setting after focus returns from another window', async () => {
  await render()
  strategy = 'baseline-sd-asr/20261026'
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(select().props.value).toBe(strategy)
})
