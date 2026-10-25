import { expect, it, vi } from 'vitest'
import { DictationSession, type DictationState } from '../src/client/dictation-session.js'
import type { MicrophoneCaptureOptions } from '../src/client/recordings/direct-recording-capture.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function setup() {
  let capture!: MicrophoneCaptureOptions
  const target = { insert: vi.fn(() => true), close: vi.fn() }, release = vi.fn(), stop = vi.fn(async () => {})
  const transcribe = vi.fn(async () => '识别文字。')
  let state!: DictationState
  const session = new DictationSession(target, 42, value => { state = value }, {
    capture: async options => { capture = options; await options.onReady(16000); return { stop } },
    transcribe, acquire: async () => release,
  })
  const chunk = (count: number, level = .2) => { for (let i = 0; i < count; i++) capture.onChunk(new ArrayBuffer(3200), level) }
  return { session, target, transcribe, stop, release, chunk, state: () => state, capture: () => capture }
}
it('uploads no silence, flushes at a natural pause, and inserts text without submitting', async () => {
  const h = setup(); await h.session.start()
  expect(h.state().phase).toBe('listening')
  h.chunk(30, 0); await settle(); expect(h.transcribe).not.toHaveBeenCalled()
  h.chunk(8); h.chunk(8, 0); await settle()
  expect(h.transcribe).toHaveBeenCalledTimes(1); expect(h.target.insert).toHaveBeenCalledExactlyOnceWith('识别文字。')
  expect(h.transcribe.mock.calls[0]![0].pcm.byteLength).toBeLessThan(384000)
  await h.session.stop(); h.session.cancel()
})
it('serializes chunks in spoken order and waits for the final partial chunk when stopping', async () => {
  const h = setup(); let finish!: (value: string) => void
  h.transcribe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await h.session.start(); h.chunk(80); h.chunk(3)
  await h.session.stop(); expect(h.state().phase).toBe('finishing')
  expect(h.target.insert).not.toHaveBeenCalled(); finish('第一句。'); await settle()
  expect(h.target.insert.mock.calls.map(call => call[0])).toEqual(['第一句。', '识别文字。'])
  expect(h.target.close).toHaveBeenCalledTimes(1); expect(h.state().phase).toBe('idle')
})
it('preserves the failed segment ID and does not duplicate already committed text on retry', async () => {
  const h = setup(); h.transcribe.mockRejectedValueOnce(new Error('离线'))
  await h.session.start(); h.chunk(80); await settle()
  expect(h.state().phase).toBe('failed'); expect(h.stop).toHaveBeenCalled()
  const segment = h.transcribe.mock.calls[0]![0]
  h.session.retry(); await settle()
  expect(h.transcribe.mock.calls[1]![0]).toBe(segment)
  expect(h.target.insert).toHaveBeenCalledTimes(1); expect(h.state().phase).toBe('idle')
})
it('never writes a late recognition result to an unmounted or switched conversation', async () => {
  const h = setup(); let finish!: (value: string) => void
  h.transcribe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await h.session.start(); h.chunk(80); await settle(); h.session.cancel(); finish('旧结果'); await settle()
  expect(h.target.insert).not.toHaveBeenCalled(); expect(h.target.close).toHaveBeenCalled()
  expect(h.transcribe.mock.calls[0]![1].aborted).toBe(true)
})
it('retains recognized text for copy if its insertion target rejects it', async () => {
  const h = setup(); h.target.insert.mockReturnValue(false)
  await h.session.start(); h.chunk(80); await settle()
  expect(h.state().phase).toBe('failed'); expect(h.session.recoverableText).toBe('识别文字。')
  h.target.insert.mockReturnValue(true); h.session.retry(); await settle()
  expect(h.transcribe).toHaveBeenCalledTimes(1); expect(h.state().phase).toBe('idle')
})
it('bounds the backlog and releases capture if recognition is slow', async () => {
  const h = setup(); h.transcribe.mockImplementation(() => new Promise(() => {}))
  await h.session.start(); h.chunk(80 * 5); await settle()
  expect(h.stop).toHaveBeenCalled(); expect(h.state().pending).toBe(5)
  expect(h.state().phase).toBe('finishing'); expect(h.transcribe).toHaveBeenCalledTimes(1)
  h.session.cancel()
})
it('releases a late microphone grant when cancelled during startup', async () => {
  let resolve!: (value: { stop(): Promise<void> }) => void
  const stop = vi.fn(async () => {}), release = vi.fn(), target = { insert: vi.fn(() => true), close: vi.fn() }
  const h = new DictationSession(target, 42, () => {}, { capture: () => new Promise(done => { resolve = done }), acquire: async () => release })
  const starting = h.start(); await settle(); h.cancel(); resolve({ stop }); await starting
  expect(stop).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1)
})
