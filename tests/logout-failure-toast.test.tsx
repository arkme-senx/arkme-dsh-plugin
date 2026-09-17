import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLogoutFailureToast } from '../src/client/ArkmeLogoutFailureToast.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Toast: ({ text, onDone }: { text: string; onDone: () => void }) => <div role="alert" onClick={onDone}>{text}</div>,
  IconWarningOutline16: () => null,
}))
let renderer: ReactTestRenderer | undefined
let events: EventTarget
beforeEach(() => {
  vi.useFakeTimers()
  events = new EventTarget()
  const storage = new Map<string, string>()
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) },
  })
  vi.stubGlobal('document', { body: {} })
})
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount())
  renderer = undefined
  vi.useRealTimers(); vi.unstubAllGlobals(); mocks.call.mockReset()
})
it('waits for logout to finish after page restoration, displays its cause, and does not replay on remount', async () => {
  mocks.call.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValue({ status: 'failed', id: 'failure-1', message: '退出登录失败：无法删除 Windows 登录凭据；操作超时' })
  await act(async () => { renderer = create(<ArkmeLogoutFailureToast />) })
  expect(renderer!.toJSON()).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(JSON.stringify(renderer!.toJSON())).toContain('操作超时')
  await act(async () => { renderer!.unmount() })
  await act(async () => { renderer = create(<ArkmeLogoutFailureToast />) })
  expect(renderer!.toJSON()).toBeNull()
})
it('shows detailed feedback for a failure without navigation and supports another retry', async () => {
  mocks.call.mockResolvedValue({ status: 'idle' })
  await act(async () => { renderer = create(<ArkmeLogoutFailureToast />) })
  for (const id of ['first', 'retry']) {
    mocks.call.mockResolvedValue({ status: 'failed', id, message: `退出登录失败：${id}` })
    await act(async () => { events.dispatchEvent(new Event('arkme:logout-failed')) })
    expect(JSON.stringify(renderer!.toJSON())).toContain(id)
    await act(async () => { renderer!.root.findByProps({ role: 'alert' }).props.onClick() })
    expect(renderer!.toJSON()).toBeNull()
  }
})
it('shows a request error if feedback cannot be fetched', async () => {
  mocks.call.mockRejectedValue(new Error('offline'))
  await act(async () => { renderer = create(<ArkmeLogoutFailureToast />) })
  const event = new Event('arkme:logout-failed')
  Object.defineProperty(event, 'detail', { value: '连接已断开' })
  await act(async () => { events.dispatchEvent(event) })
  expect(JSON.stringify(renderer!.toJSON())).toContain('退出登录失败：连接已断开')
})
it('stops pending checks when the page unmounts', async () => {
  mocks.call.mockResolvedValue({ status: 'pending' })
  await act(async () => { renderer = create(<ArkmeLogoutFailureToast />) })
  await act(async () => { renderer!.unmount() })
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.call).toHaveBeenCalledTimes(1)
})
