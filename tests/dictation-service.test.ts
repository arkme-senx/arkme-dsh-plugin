import { expect, it, vi } from 'vitest'
import { DictationService } from '../src/services/dictation-service.js'

function setup() {
  let userId = 42
  const runtime = {
    requireSession: vi.fn(async () => ({ userId, accessToken: 'host-secret' })),
    authenticatedAuthMultipartPost: vi.fn(async () => ({ fileName: 'private.wav' })),
    authenticatedAuthPost: vi.fn(async () => ({ unable_file_name_ls: [] })),
    authenticatedAuthReadPost: vi.fn(async () => ({ trans_already_ls: [{ file_name: 'private.wav', trans_text: '你好，这是听写。' }] })),
  }
  const input = { expectedUserId: 42, segmentId: crypto.randomUUID(), pcm: Buffer.alloc(32000).toString('base64') }
  return { runtime, input, service: new DictationService(runtime as never), changeAccount() { userId = 99 } }
}
it('uses Flutter’s private upload/recognition APIs with a valid WAV and never publishes a message', async () => {
  const h = setup()
  expect(await h.service.transcribe(h.input)).toEqual({ text: '你好，这是听写。' })
  const [path, form, session] = h.runtime.authenticatedAuthMultipartPost.mock.calls[0] as any
  expect(path).toBe('/api/v1/premium/upload/short-voice'); expect(session.userId).toBe(42)
  expect(form.get('sec')).toBe('1')
  const wav = Buffer.from(await (form.get('file') as Blob).arrayBuffer())
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.readUInt32LE(24)).toBe(16000)
  expect(wav.readUInt16LE(22)).toBe(1); expect(wav.length).toBe(32044)
  expect(h.runtime.authenticatedAuthPost).toHaveBeenCalledWith('/api/v1/premium/trans/short-voice', { file_ls: [{ name: 'private.wav', sec: 1 }] }, expect.anything(), undefined)
  expect(h.runtime.authenticatedAuthReadPost.mock.calls[0]![0]).toBe('/api/v1/premium/list/short-voice-trans')
})
it('deduplicates concurrent submission and receipt retries without uploading or charging a second time', async () => {
  const h = setup()
  const [a, b] = await Promise.all([h.service.transcribe(h.input), h.service.transcribe(h.input)])
  expect(a).toEqual(b); await h.service.transcribe(h.input)
  expect(h.runtime.authenticatedAuthMultipartPost).toHaveBeenCalledTimes(1)
  expect(h.runtime.authenticatedAuthPost).toHaveBeenCalledTimes(1)
  await expect(h.service.transcribe({ ...h.input, pcm: Buffer.alloc(32000, 1).toString('base64') })).rejects.toThrow('片段已变化')
})
it.each(['not base64', '', Buffer.alloc(3).toString('base64'), Buffer.alloc(384002).toString('base64')])('rejects invalid or oversized audio before contacting upstream', async pcm => {
  const h = setup()
  await expect(h.service.transcribe({ ...h.input, pcm })).rejects.toThrow('听写')
  expect(h.runtime.authenticatedAuthMultipartPost).not.toHaveBeenCalled()
})
it('refuses cross-account input and ignores late responses after an account switch', async () => {
  const h = setup()
  await expect(h.service.transcribe({ ...h.input, expectedUserId: 77 })).rejects.toThrow('账号')
  h.runtime.authenticatedAuthReadPost.mockImplementationOnce(async () => { h.changeAccount(); return { trans_already_ls: [{ file_name: 'private.wav', trans_text: '不能写入' }] } })
  await expect(h.service.transcribe(h.input)).rejects.toThrow('账号')
})
it('surfaces the actual quota rejection and preserves its upload receipt for an explicit retry', async () => {
  const h = setup()
  h.runtime.authenticatedAuthPost.mockResolvedValueOnce({ unable_file_name_ls: ['private.wav'] } as never)
  await expect(h.service.transcribe(h.input)).rejects.toThrow('权益不足')
  expect(h.runtime.authenticatedAuthReadPost).not.toHaveBeenCalled()
  await h.service.transcribe(h.input)
  expect(h.runtime.authenticatedAuthMultipartPost).toHaveBeenCalledTimes(1)
})
it('retry after a read failure reuses the same uploaded file and recognition request', async () => {
  const h = setup()
  h.runtime.authenticatedAuthReadPost.mockRejectedValueOnce(new Error('network unavailable'))
  await expect(h.service.transcribe(h.input)).rejects.toThrow('识别结果读取失败')
  await h.service.transcribe(h.input)
  expect(h.runtime.authenticatedAuthMultipartPost).toHaveBeenCalledTimes(1)
  expect(h.runtime.authenticatedAuthPost).toHaveBeenCalledTimes(1)
})
it('cancellation during result polling is bounded and does not return cached old-account text', async () => {
  const h = setup(), controller = new AbortController()
  h.runtime.authenticatedAuthReadPost.mockImplementationOnce(async () => { controller.abort(); return { waiting_trans_ls: [{ file_name: 'private.wav' }] } as never })
  await expect(h.service.transcribe(h.input, controller.signal)).rejects.toThrow()
  h.service.dispose(); h.changeAccount()
  await expect(h.service.transcribe(h.input)).rejects.toThrow('账号')
})
