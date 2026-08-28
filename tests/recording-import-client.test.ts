import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadArkmeRecording } from '../src/client/api.js'
import {
  inspectArkmeRecordingSelection,
  validateArkmeRecordingSelection,
} from '../src/client/recordings/recording-import-selection.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('recording import client gateway', () => {
  it('rejects unsupported, empty, oversized and over-ten-hour selections before upload', async () => {
    expect(validateArkmeRecordingSelection(new File(['x'], 'notes.txt'))).toEqual({
      ok: false,
      message: '仅支持 WAV、MP3 和 M4A 录音',
    })
    expect(validateArkmeRecordingSelection(new File([], 'empty.wav'))).toEqual({
      ok: false,
      message: '录音文件不能为空',
    })
    expect(validateArkmeRecordingSelection({ name: 'huge.m4a', size: 1024 ** 3 + 1 } as File)).toEqual({
      ok: false,
      message: '录音文件不能超过 1 GiB',
    })

    await expect(inspectArkmeRecordingSelection(new File(['audio'], 'meeting.mp3'), {
      probe: async () => ({ format: 'MP3', durationMillis: 10 * 60 * 60 * 1_000 + 1 }),
    })).resolves.toEqual({
      ok: false,
      message: '录音时长不能超过 10 小时',
    })
  })

  it('reports the detected format and duration while keeping Host validation authoritative', async () => {
    await expect(inspectArkmeRecordingSelection(new File(['audio'], 'meeting.m4a'), {
      probe: async () => ({ format: 'M4A', durationMillis: 7_727_000 }),
    })).resolves.toEqual({
      ok: true,
      format: 'M4A',
      durationMillis: 7_727_000,
    })
  })

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
