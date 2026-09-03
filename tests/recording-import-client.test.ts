import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadArkmeRecording } from '../src/client/api.js'
import {
  inspectArkmeRecordingSelection,
  validateArkmeRecordingSelection,
} from '../src/client/recordings/recording-import-selection.js'
import {
  recordingImportEndTimeError,
  recordingImportLocalInputValue,
  recordingImportStartFromFileName,
} from '../src/client/recordings/ArkmeRecordingImportDialog.js'
import { desktopRecorderImaAdpcmMonoWav } from './recording-import-ima-adpcm-fixture.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('recording import client gateway', () => {
  it('preserves second precision for the imported recording start time', () => {
    expect(recordingImportLocalInputValue(new Date(2026, 7, 28, 9, 12, 34)))
      .toBe('2026-08-28T09:12:34')
  })

  it('uses the selected day as fallback, parses desktop filename timestamps and rejects future end times', () => {
    const selectedDay = new Date(2026, 7, 28).getTime()
    expect(recordingImportStartFromFileName('会议_20260828_091234.m4a', selectedDay))
      .toBe(new Date(2026, 7, 28, 9, 12, 34).getTime())
    expect(recordingImportStartFromFileName('普通会议.m4a', selectedDay))
      .toBe(selectedDay)
    expect(recordingImportStartFromFileName('会议_20261339_256199.m4a', selectedDay))
      .toBe(selectedDay)
    expect(recordingImportEndTimeError(2_000, 1_000, 2_999)).toBe('录音结束时间不能晚于当前时间')
    expect(recordingImportEndTimeError(2_000, 1_000, 3_000)).toBe('')
    expect(recordingImportEndTimeError(0, 1_000, 3_000)).toBe('')
    expect(recordingImportEndTimeError(-1, 1_000, 3_000)).toBe('仅支持1970年至今的日期')
  })

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

  it('accepts a desktop IMA ADPCM WAV before upload', async () => {
    const file = new File([desktopRecorderImaAdpcmMonoWav()], 'R20260826-014759.WAV', { type: 'audio/wav' })

    await expect(inspectArkmeRecordingSelection(file)).resolves.toEqual({
      ok: true,
      format: 'WAV',
      durationMillis: 1_010,
    })
  })

  it('does not let IMA ADPCM support bypass the declared file format check', async () => {
    const disguised = new File([desktopRecorderImaAdpcmMonoWav()], 'disguised.mp3', { type: 'audio/mpeg' })

    await expect(inspectArkmeRecordingSelection(disguised)).resolves.toEqual({
      ok: false,
      message: '录音格式与文件内容不一致',
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
    const controller = new AbortController()

    await expect(uploadArkmeRecording('/arkme-self/api/recording/import', file, 1_725_000_000_000, 0, controller.signal))
      .resolves.toMatchObject({ importRef: 'opaque', phase: 'prepared' })
    expect(fetch).toHaveBeenCalledWith('/arkme-self/api/recording/import', expect.objectContaining({
      method: 'POST', body: file, credentials: 'same-origin', redirect: 'error',
      signal: controller.signal,
      headers: expect.objectContaining({
        'Content-Type': 'audio/mp4',
        'X-Arkme-File-Name': encodeURIComponent('会议.m4a'),
        'X-Arkme-Start-At': '1725000000000',
        'X-Arkme-Belong-User': '0',
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

  it('returns a bounded error when the loopback route does not return JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad Gateway', { status: 502 })))

    await expect(uploadArkmeRecording('/arkme-self/api/recording/import', new File(['x'], 'bad.mp3'), 1))
      .rejects.toThrow('录音导入失败')
  })
})
