import { expect, it, vi } from 'vitest'
import { acquireDictation, dictationActive, subscribeDictationActivity } from '../src/client/dictation-activity.js'
import { ArkmeRecordInputCaptureOwner } from '../src/client/record-input-capture.js'
const mock = vi.hoisted(() => ({ lock: vi.fn() }))
vi.mock('../src/client/microphone-lock.js', () => ({ lockMicrophone: mock.lock }))
it('pauses background recording before acquiring dictation and preserves previous audio when resuming', async () => {
  const releaseLock = vi.fn(); mock.lock.mockResolvedValueOnce(releaseLock)
  const recorder = { start: vi.fn(async () => {}), stop: vi.fn(async () => ({ blob: new Blob(['prior']), fileName: 'prior.webm', mimeType: 'audio/webm', durationMillis: 1000 })), cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {}), subscribeAmplitude: () => () => {} }
  const owner = new ArkmeRecordInputCaptureOwner({ accountId: 42, recorder, backgroundSoundEnabled: () => true, microphoneReady: () => true, captureContext: async () => ({}), subscribeBackgroundSoundPreference: () => () => {} })
  owner.sync({ draftKey: 'draft', isActive: true, hasUserContent: true })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(recorder.start).toHaveBeenCalledTimes(1)
  const release = await acquireDictation(() => {})
  expect(dictationActive()).toBe(true); expect(recorder.stop).toHaveBeenCalledTimes(1)
  await expect(acquireDictation(() => {})).rejects.toThrow('另一个输入框')
  expect(recorder.cancel).not.toHaveBeenCalled()
  release(); await new Promise(resolve => setTimeout(resolve, 10))
  expect(dictationActive()).toBe(false); expect(releaseLock).toHaveBeenCalledTimes(1)
  expect(recorder.start).toHaveBeenCalledTimes(2)
  const result = await owner.finishForSubmit('draft')
  expect(result?.backgroundSound.segments.length).toBeGreaterThanOrEqual(1)
  await owner.dispose()
})
it('restores background owners if microphone arbitration rejects direct-recording overlap', async () => {
  mock.lock.mockRejectedValueOnce(new Error('已有录音'))
  const listener = vi.fn(), stop = subscribeDictationActivity(listener)
  await expect(acquireDictation(() => {})).rejects.toThrow('已有录音')
  expect(dictationActive()).toBe(false); expect(listener.mock.calls.map(call => call[0])).toEqual([true, false]); stop()
})
