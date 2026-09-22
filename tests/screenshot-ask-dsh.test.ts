import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: { status: 'authenticated', environment: 'test', userId: 42 }, listeners: new Set<() => void>(), show: vi.fn() }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { getSnapshot: () => ({ auth: mocks.auth }), subscribe: (fn: () => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn) } } }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showHarness: mocks.show } }))
import { bindScreenshotAskDsh } from '../src/client/screenshot-ask-dsh.js'
import { HARNESS_ATTACHMENT_DRAFT_KEY, type DraftRequest } from '../src/client/harness-attachment-draft.js'
import type { ScreenshotAskRequest } from '../src/client/native-screenshot.js'
let dispose = () => {}
afterEach(() => { dispose(); mocks.auth.userId = 42; mocks.listeners.clear(); vi.unstubAllGlobals(); vi.clearAllMocks() })
function setup(prepare = vi.fn().mockResolvedValue({ sessionId: 'new' })) {
  let request!: (r: ScreenshotAskRequest) => void, cancel!: (r: {requestId:string}) => void, activate!: (r: {requestId:string}) => void
  const result = vi.fn().mockResolvedValue(true), focus = vi.fn()
  vi.stubGlobal('arkmeScreenshot', { version: 1, askDshResult: result,
    onAskDsh: (fn: typeof request) => { request = fn; return vi.fn() }, onAskDshCancel: (fn: typeof cancel) => { cancel = fn; return vi.fn() }, onAskDshActivate: (fn: typeof activate) => { activate = fn; return vi.fn() },
  })
  const surface = { isConnected: true, getAttribute: (key: string) => key === 'data-arkme-account-id' ? '42' : 'test:42', querySelector: () => ({ contentWindow: { [HARNESS_ATTACHMENT_DRAFT_KEY]: { prepare }, focus }, contentDocument: { querySelector: () => ({ focus }) } }) }
  vi.stubGlobal('document', { querySelectorAll: () => [surface] }); vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1 })
  dispose = bindScreenshotAskDsh()
  return { prepare, result, focus, request, cancel, activate }
}
const payload = { requestId: 'request', operationId: 'operation', contentBase64: btoa('PNG bytes'), fileName: '截图.png' }
it('reuses native draft preparation and activates only after the editor closes', async () => {
  const env = setup(); env.request(payload)
  await vi.waitFor(() => expect(env.result).toHaveBeenCalledWith({ requestId: 'request', ok: true }))
  const draft = env.prepare.mock.calls[0]![0] as DraftRequest
  expect(draft.operationId).toBe('operation'); expect(draft.files).toHaveLength(1)
  expect(draft.files[0]!.type).toBe('image/png'); expect(draft.files[0]!.name).toBe('截图.png'); expect(await draft.files[0]!.text()).toBe('PNG bytes')
  expect(mocks.show).not.toHaveBeenCalled(); env.activate(payload)
  expect(mocks.show).toHaveBeenCalledTimes(1); expect(env.focus).toHaveBeenCalled(); expect(mocks.listeners.size).toBe(0)
})
it('reports failure without navigation and permits retry', async () => {
  const env = setup(vi.fn().mockRejectedValue(new Error('上传失败'))); env.request(payload)
  await vi.waitFor(() => expect(env.result).toHaveBeenCalledWith({ requestId: 'request', ok: false, error: '上传失败' }))
  env.activate(payload); expect(mocks.show).not.toHaveBeenCalled()
  env.request({ ...payload, requestId: 'retry' }); await vi.waitFor(() => expect(env.prepare).toHaveBeenCalledTimes(2))
  expect(env.prepare.mock.calls[1]![0].operationId).toBe('operation')
})
it.each(['cancel', 'account', 'dispose'])('aborts preparation on %s and ignores late completion', async kind => {
  const ready = Promise.withResolvers<{sessionId:string}>(), prepare = vi.fn().mockReturnValue(ready.promise)
  const env = setup(prepare); env.request(payload)
  const signal = (prepare.mock.calls[0]![0] as DraftRequest).signal
  if (kind === 'cancel') env.cancel(payload)
  else if (kind === 'account') { mocks.auth.userId = 99; for (const fn of mocks.listeners) fn() }
  else dispose()
  expect(signal.aborted).toBe(true); ready.resolve({ sessionId: 'late' }); await Promise.resolve(); await Promise.resolve()
  env.activate(payload); expect(env.result).not.toHaveBeenCalled(); expect(mocks.show).not.toHaveBeenCalled()
})
it('rejects missing DSH readiness without creating attachments', async () => {
  const env = setup(); vi.stubGlobal('document', { querySelectorAll: () => [] }); env.request(payload)
  await vi.waitFor(() => expect(env.result).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining('尚未就绪') })))
  expect(env.prepare).not.toHaveBeenCalled()
})
