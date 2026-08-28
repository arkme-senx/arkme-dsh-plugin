import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadArkmeRecording } from '../src/client/api.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('recording import client gateway', () => {
  it('owns the same-origin raw upload request outside the React surface', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: {
        importRef: 'opaque', revision: 1, phase: 'prepared', fileName: '会议.m4a',
        fileSize: 3, durationMillis: 1_000, progress: 0,
      },
    }), { status: 202, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const file = new File(['abc'], '会议.m4a', { type: '' })

    await expect(uploadArkmeRecording('/arkme-self/api/recording/import', file, 1_725_000_000_000))
      .resolves.toMatchObject({ importRef: 'opaque', phase: 'prepared' })
    expect(fetch).toHaveBeenCalledWith('/arkme-self/api/recording/import', expect.objectContaining({
      method: 'POST', body: file, credentials: 'same-origin', redirect: 'error',
      headers: expect.objectContaining({
        'Content-Type': 'audio/mp4',
        'X-Arkme-File-Name': encodeURIComponent('会议.m4a'),
        'X-Arkme-Start-At': '1725000000000',
      }),
    }))
  })

  it('returns the bounded Host error rather than accepting an invalid response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false, error: { message: '录音格式与文件内容不一致' },
    }), { status: 400, headers: { 'content-type': 'application/json' } })))
    await expect(uploadArkmeRecording('/arkme-self/api/recording/import', new File(['x'], 'bad.mp3'), 1))
      .rejects.toThrow('录音格式与文件内容不一致')
  })
})
