import { expect, it, vi } from 'vitest'
import { DictationSession, type DictationState } from '../src/client/dictation-session.js'
import type { MicrophoneCaptureOptions } from '../src/client/recordings/direct-recording-capture.js'
import type { RealtimeDictationOptions } from '../src/realtime-dictation-client.js'
import type { RealtimeDictationSnapshot } from '../src/realtime-dictation-contract.js'
vi.mock('../src/client/api.js', () => ({ connectRealtimeDictation: vi.fn() }))
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function setup() {
  let capture!: MicrophoneCaptureOptions, options!: RealtimeDictationOptions
  const target = { insert: vi.fn(() => true), replace: vi.fn(() => true), close: vi.fn() }, release = vi.fn(), stop = vi.fn(async () => {})
  const stream = { send: vi.fn(), finish: vi.fn(), dispose: vi.fn() }
  let state!: DictationState
  const session = new DictationSession(target, 42, value => { state = value }, {
    capture: async value => { capture = value; await value.onReady(16000); return { stop } },
    connect: async value => { options = value; return stream }, acquire: async () => release,
  })
  const update = (text: string, phase: RealtimeDictationSnapshot['phase'] = 'listening') => options.onUpdate({ version: 1, streamRef: 'ref', phase, text, revision: 1 })
  return { session, target, stream, stop, release, update, state: () => state, capture: () => capture, options: () => options }
}
it('streams each PCM chunk immediately, including silence, and replaces cumulative text before stopping', async () => {
  const h = setup(); await h.session.start()
  h.capture().onChunk(new ArrayBuffer(3200), 0)
  expect(h.stream.send).toHaveBeenCalledTimes(1)
  h.update('你好'); h.update('你好，世界。')
  expect(h.target.replace.mock.calls.map(call => call[0])).toEqual(['你好', '你好，世界。'])
  expect(h.target.insert).not.toHaveBeenCalled()
  await h.session.stop(); expect(h.state().phase).toBe('finishing')
  expect(h.stream.finish).toHaveBeenCalledTimes(1)
  h.update('你好，世界！', 'finished')
  expect(h.state().phase).toBe('idle'); expect(h.target.replace).toHaveBeenLastCalledWith('你好，世界！')
  expect(h.release).toHaveBeenCalledTimes(1)
})
it('flushes the capture tail before sending the end marker', async () => {
  const h = setup(); await h.session.start()
  h.stop.mockImplementationOnce(async () => h.capture().onChunk(new ArrayBuffer(400), .1))
  await h.session.stop()
  expect(h.stream.send.mock.invocationCallOrder[0]).toBeLessThan(h.stream.finish.mock.invocationCallOrder[0]!)
})
it('never inserts late results after an editor or account switch', async () => {
  const h = setup(); await h.session.start(); h.session.cancel(); h.update('旧结果')
  expect(h.target.replace).not.toHaveBeenCalled(); expect(h.stream.dispose).toHaveBeenCalledTimes(1)
  expect(h.options().signal!.aborted).toBe(true); await settle(); expect(h.release).toHaveBeenCalledTimes(1)
})
it('retains the hypothesis for copy and insertion retry when the user edits its range', async () => {
  const h = setup(); await h.session.start(); h.target.replace.mockReturnValue(false)
  h.update('保留的结果'); await settle()
  expect(h.state().phase).toBe('failed'); expect(h.session.recoverableText).toBe('保留的结果')
  expect(h.stream.dispose).toHaveBeenCalled(); h.target.replace.mockReturnValue(true); h.session.retry()
  expect(h.state().phase).toBe('idle'); expect(h.stream.send).not.toHaveBeenCalled()
})
it('does not replay audio after transport failure and preserves inserted text', async () => {
  const h = setup(); await h.session.start(); h.update('已写入')
  h.options().onError(new Error('连接断开')); await settle()
  expect(h.state().phase).toBe('failed'); expect(h.session.canRetry).toBe(false)
  expect(h.target.replace).toHaveBeenCalledExactlyOnceWith('已写入')
  expect(h.stop).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledTimes(1)
})
it('releases a late microphone grant when cancelled during startup', async () => {
  let resolve!: (value: { stop(): Promise<void> }) => void
  const stop = vi.fn(async () => {}), release = vi.fn(), target = { insert: vi.fn(() => true), replace: vi.fn(() => true), close: vi.fn() }
  const stream = { send: vi.fn(), finish: vi.fn(), dispose: vi.fn() }
  const h = new DictationSession(target, 42, () => {}, { connect: async () => stream, capture: () => new Promise(done => { resolve = done }), acquire: async () => release })
  const starting = h.start(); await settle(); h.cancel(); resolve({ stop }); await starting
  expect(stop).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1)
})
it('cancels startup before capture and releases a late connection', async () => {
  let resolve!: (value: any) => void
  const stream = { send: vi.fn(), finish: vi.fn(), dispose: vi.fn() }, release = vi.fn(), capture = vi.fn()
  const h = new DictationSession({ insert: () => true, replace: () => true, close() {} }, 42, () => {}, { connect: () => new Promise(done => { resolve = done }), capture: async options => { await options.onReady(16000); capture(); return { stop: async () => {} } }, acquire: async () => release })
  const starting = h.start(); await settle(); await h.stop(); resolve(stream); await starting
  expect(capture).not.toHaveBeenCalled(); expect(stream.dispose).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1)
})
