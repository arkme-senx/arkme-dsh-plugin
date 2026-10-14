import { expect, it, vi } from 'vitest'
import { ProjectionUpload } from '../src/dsh-remote/projection-upload.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
it('isolates retired identities, keeps valid writes, backs off and clears on account change', async () => {
  const uploader = new ProjectionUpload(), signal = new AbortController().signal
  const items = Array.from({ length: 100 }, (_, i) => ({ session_ref: String(i) }))
  const written = new Set<string>(), send = vi.fn(async (batch: typeof items) => {
    if (batch.some(item => item.session_ref === '0')) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', 'retired')
    for (const item of batch) written.add(item.session_ref)
  })
  expect(await uploader.page(items, send, signal)).toEqual({ accepted: 99, rejected: 1 })
  expect(written.size).toBe(99); expect(written.has('0')).toBe(false)
  expect(send.mock.calls.length).toBeLessThan(20)
  send.mockClear()
  for (let i = 0; i < 20; i++) expect(await uploader.page(items, send, signal)).toEqual({ accepted: 99, rejected: 1 })
  expect(send).toHaveBeenCalledTimes(20)
  uploader.clear(); send.mockClear(); await uploader.page(items, send, signal)
  expect(send.mock.calls.length).toBeGreaterThan(1)
})
it('does not split transport/auth failures or cache account cancellation', async () => {
  const uploader = new ProjectionUpload(), abort = new AbortController()
  const send = vi.fn(async () => { throw new DshRemoteError('REMOTE_LOGIN_REQUIRED', 'expired') })
  await expect(uploader.page([{ session_ref: 'a' }, { session_ref: 'b' }], send, abort.signal)).rejects.toThrow('expired')
  expect(send).toHaveBeenCalledOnce()
  abort.abort(); await expect(uploader.page([{ session_ref: 'a' }], send, abort.signal)).rejects.toThrow()
  expect(send).toHaveBeenCalledOnce()
})
