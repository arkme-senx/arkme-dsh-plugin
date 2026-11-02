import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeReactionHistoryLock } from '../src/client/ArkmeReactionHistorySettings.js'
const remote = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: remote.call }))
let view: ReactTestRenderer | undefined
const toggle = () => view!.root.findByProps({ role: 'switch' })
afterEach(() => { act(() => view?.unmount()); view = undefined; remote.call.mockReset(); vi.unstubAllGlobals() })
it('reads before enabling the switch and never writes on mount', async () => {
  let finish!: (value: unknown) => void
  remote.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { view = create(<ArkmeReactionHistoryLock scope="prod:7" />) })
  expect(toggle().props.disabled).toBe(true)
  expect(toggle().props['aria-label']).toBe('表态记录隐私锁')
  expect(toggle().props['aria-describedby']).toBeTruthy()
  expect(view!.root.findByProps({ role: 'status' }).children).toEqual(['读取中…'])
  await act(async () => finish({ locked: true, revision: 4 }))
  expect(toggle().props.disabled).toBe(false)
  expect(toggle().props['aria-checked']).toBe(true)
  expect(remote.call).toHaveBeenCalledTimes(1)
  expect(remote.call.mock.calls[0]?.[1]).toEqual({ action: 'history-policy-query', accountKey: 'prod:7' })
})
it('waits for the account-scoped save before changing state and refreshes history', async () => {
  vi.stubGlobal('window', new EventTarget())
  const changed = vi.fn(); window.addEventListener('arkme-reaction-policy-changed', changed)
  remote.call.mockResolvedValueOnce({ locked: false, revision: 4 })
  let finish!: (value: unknown) => void
  remote.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { view = create(<ArkmeReactionHistoryLock scope="prod:7" />) })
  await act(async () => toggle().props.onClick())
  expect(toggle().props.disabled).toBe(true)
  expect(toggle().props['aria-checked']).toBe(false)
  expect(remote.call.mock.calls[1]?.[1]).toEqual({ action: 'history-policy-set', accountKey: 'prod:7', expected_revision: 4, locked: true })
  await act(async () => finish({ outcome: 'updated', policy: { locked: true, revision: 5 } }))
  expect(toggle().props['aria-checked']).toBe(true)
  expect(changed).toHaveBeenCalledTimes(1)
})
it('offers a read-only retry when the setting cannot be loaded', async () => {
  remote.call.mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce({ locked: false, revision: 3 })
  await act(async () => { view = create(<ArkmeReactionHistoryLock scope="prod:7" />) })
  expect(toggle().props.disabled).toBe(true)
  expect(view!.root.findByProps({ role: 'alert' }).findByType('span').children).toEqual(['网络不可用'])
  await act(async () => view!.root.findByProps({ role: 'alert' }).findByType('button').props.onClick())
  expect(toggle().props.disabled).toBe(false)
  expect(remote.call.mock.calls.every(call => call[1].action === 'history-policy-query')).toBe(true)
})
it('shows the server state on conflict instead of overwriting another device', async () => {
  vi.stubGlobal('window', new EventTarget())
  remote.call.mockResolvedValueOnce({ locked: false, revision: 4 })
    .mockResolvedValueOnce({ outcome: 'revision_conflict', policy: { locked: true, revision: 8 } })
  await act(async () => { view = create(<ArkmeReactionHistoryLock scope="prod:7" />) })
  await act(async () => toggle().props.onClick())
  expect(toggle().props['aria-checked']).toBe(true)
  expect(view!.root.findByProps({ role: 'alert' }).findByType('span').children).toEqual(['设置已在其他设备更新，请重新操作'])
  expect(remote.call).toHaveBeenCalledTimes(2)
})
it('cancels a prior-account read and keeps the new account disabled until its own policy arrives', async () => {
  let finish!: (value: unknown) => void
  remote.call.mockResolvedValueOnce({ locked: true, revision: 4 })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { view = create(<ArkmeReactionHistoryLock scope="prod:7" />) })
  const oldSignal = remote.call.mock.calls[0]?.[2]
  await act(async () => view!.update(<ArkmeReactionHistoryLock scope="prod:8" />))
  expect(oldSignal.aborted).toBe(true)
  expect(toggle().props.disabled).toBe(true)
  expect(toggle().props['aria-checked']).toBe(false)
  await act(async () => finish({ locked: false, revision: 0 }))
  expect(toggle().props.disabled).toBe(false)
})
