import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), auth: { status: 'authenticated', environment: 'test', userId: 42 }, listeners: new Set<() => void>() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: {
  getSnapshot: () => ({ auth: mocks.auth }),
  subscribe: (fn: () => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn) },
} }))
import { useAskDsh } from '../src/client/use-ask-dsh.js'
import { HARNESS_ATTACHMENT_DRAFT_KEY, type DraftRequest } from '../src/client/harness-attachment-draft.js'
const note = { itemUid: 'one', messageActionRef: 'signed-ref', senderName: '我', isMe: true, sendAtMillis: 1000, title: '标题', textContent: '完整正文', status: 0 }
let renderer: ReactTestRenderer | undefined
let state: ReturnType<typeof useAskDsh>
function Harness({ scope = 'account:source', done }: { scope?: string; done: () => void }) { state = useAskDsh(scope, done); return <button disabled={state.busy} onClick={() => state.run('source', [note])}>{state.status}</button> }
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; mocks.auth.userId = 42; mocks.listeners.clear(); vi.unstubAllGlobals(); vi.clearAllMocks() })
function environment(prepare: (request: DraftRequest) => Promise<{ sessionId: string }>) {
  const focus = vi.fn()
  const surface = { isConnected: true, getAttribute: (key: string) => key === 'data-arkme-account-id' ? '42' : 'test:42', querySelector: () => ({ contentWindow: { [HARNESS_ATTACHMENT_DRAFT_KEY]: { prepare }, focus }, contentDocument: { querySelector: () => ({ focus }) } }) }
  vi.stubGlobal('document', { querySelectorAll: () => [surface] })
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1 })
  mocks.call.mockResolvedValue({ itemUid: 'one', title: '标题', textContent: '完整正文', contentBlocks: [], backgroundSound: 'unknown' })
  return focus
}
it('prepares full notes then activates only after the native draft acknowledgement', async () => {
  const ready = Promise.withResolvers<{ sessionId: string }>()
  let captured: DraftRequest | undefined
  const focus = environment(request => { captured = request; return ready.promise })
  const done = vi.fn()
  await act(async () => { renderer = create(<Harness done={done} />) })
  let pending: Promise<void>
  await act(async () => { pending = state.run('source', [note]); await Promise.resolve() })
  expect(state.busy).toBe(true); expect(done).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledWith('source.message-snapshot.detail', expect.objectContaining({ includeAttachments: true }), expect.any(AbortSignal))
  expect(await captured!.files[0]!.text()).toContain('完整正文')
  await act(async () => { ready.resolve({ sessionId: 'new' }); await pending })
  expect(done).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalled(); expect(state.busy).toBe(false)
})
it('retains the operation identity on retry and surfaces failures without activation', async () => {
  const ids: string[] = []
  environment(async request => { ids.push(request.operationId); throw new Error('附件上传失败') })
  const done = vi.fn(); await act(async () => { renderer = create(<Harness done={done} />) })
  await act(async () => { await state.run('source', [note]) })
  expect(state.status).toContain('上传失败'); expect(done).not.toHaveBeenCalled()
  await act(async () => { await state.run('source', [note]) })
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1])
})
it('cancels on scope change and allows starting again without a stuck busy state', async () => {
  let signal: AbortSignal | undefined
  environment(request => { signal = request.signal; return new Promise((_, reject) => { request.signal.addEventListener('abort', () => reject(Error('取消')), { once: true }) }) })
  const done = vi.fn(); await act(async () => { renderer = create(<Harness done={done} />) })
  await act(async () => { void state.run('source', [note]); await Promise.resolve() })
  await act(async () => { renderer!.update(<Harness scope="other" done={done} />) })
  expect(signal?.aborted).toBe(true); expect(state.busy).toBe(false); expect(done).not.toHaveBeenCalled()
})
