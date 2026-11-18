// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeArrangementItem } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), prepare: vi.fn(), play: vi.fn(), cancel: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/arrangement-completion-sound.js', () => ({ prepareArrangementCompletionSound: mock.prepare }))
import { useArrangementCompletion } from '../src/client/use-arrangement-completion.js'

const item: ArkmeArrangementItem = { arrangementRef: 'isolated', title: '隔离样例', description: '', status: 'following', reminderEnabled: false, reminderState: '', createdAtMillis: 1, updatedAtMillis: 1 }
let host: HTMLDivElement, root: Root
const hooks = new Map<string, ReturnType<typeof useArrangementCompletion>>()
function Probe({ id, scope }: { id: string; scope: string }) {
  const completion = useArrangementCompletion(scope); hooks.set(id, completion)
  return <button data-probe={id} aria-pressed={completion.sound} onClick={() => completion.setSound(!completion.sound)} />
}
const render = async () => { await act(async () => root.render(<><Probe id="main" scope="account-a" /><Probe id="related" scope="account-a" /><Probe id="other" scope="account-b" /></>)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); hooks.clear()
  mock.call.mockReset().mockResolvedValue({ item: { ...item, status: 'completed' } }); mock.play.mockReset(); mock.cancel.mockReset()
  mock.prepare.mockReset().mockImplementation(() => ({ play: mock.play, cancel: mock.cancel }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })

it('shares one live sound setting across views while keeping accounts separate', async () => {
  await render()
  await act(async () => host.querySelector<HTMLButtonElement>('[data-probe=main]')!.click())
  expect(hooks.get('main')!.sound).toBe(false); expect(hooks.get('related')!.sound).toBe(false); expect(hooks.get('other')!.sound).toBe(true)
  await hooks.get('related')!.transition(item, 'completed', new AbortController().signal)
  expect(mock.prepare).not.toHaveBeenCalled(); expect(mock.call).toHaveBeenCalledTimes(1)
  localStorage.setItem('arkme:arrangements:sound:account-a', 'on')
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'arkme:arrangements:sound:account-a' })))
  expect(hooks.get('main')!.sound).toBe(true); expect(hooks.get('related')!.sound).toBe(true)
})
it('shares a session fallback if local storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
  await render(); await act(async () => hooks.get('main')!.setSound(false))
  expect(hooks.get('related')!.sound).toBe(false); expect(hooks.get('other')!.sound).toBe(true)
  // Restore the preference in the shared fallback so it cannot leak into the next test.
  await act(async () => hooks.get('main')!.setSound(true))
})
it('prepares from the gesture, waits for confirmation and stays silent if muted while saving', async () => {
  let finish!: (value: unknown) => void
  mock.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render()
  const pending = hooks.get('related')!.transition(item, 'completed', new AbortController().signal)
  expect(mock.prepare).toHaveBeenCalledTimes(1); expect(mock.play).not.toHaveBeenCalled()
  await act(async () => hooks.get('main')!.setSound(false))
  finish({ item: { ...item, status: 'completed' } }); await pending
  expect(mock.play).not.toHaveBeenCalled(); expect(mock.cancel).toHaveBeenCalledTimes(1)
})
it('does not replay feedback after cancellation or for an already completed item', async () => {
  let finish!: (value: unknown) => void
  mock.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render(); const controller = new AbortController()
  const pending = hooks.get('related')!.transition(item, 'completed', controller.signal)
  controller.abort(); finish({ item: { ...item, status: 'completed' } })
  await expect(pending).rejects.toThrow(); expect(mock.cancel).toHaveBeenCalledTimes(1); expect(mock.play).not.toHaveBeenCalled()
  mock.call.mockClear(); mock.cancel.mockClear()
  await hooks.get('related')!.transition({ ...item, status: 'completed' }, 'completed', new AbortController().signal)
  expect(mock.call).not.toHaveBeenCalled(); expect(mock.play).not.toHaveBeenCalled(); expect(mock.cancel).toHaveBeenCalledTimes(1)
})
it('keeps a confirmed completion successful even when audio playback fails', async () => {
  await render(); mock.play.mockImplementation(() => { throw new Error('audio unavailable') })
  await expect(hooks.get('related')!.transition(item, 'completed', new AbortController().signal)).resolves.toMatchObject({ result: { status: 'completed' } })
  expect(mock.play).toHaveBeenCalledTimes(1)
})
