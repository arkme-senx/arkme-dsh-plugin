import { LocalRecordingDirectorySource } from '../src/recording-directory-source.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareRecordingDirectory, recordingDirectoryStartTime } from '../src/recording-directory-import.js'

afterEach(() => vi.unstubAllEnvs())

describe('directory recording wall-clock ambiguity', () => {
  it.each([
    ['America/New_York', 'R20251102-013000.WAV', '2025-11-02T05:30:00Z', '2025-11-02T06:30:00Z'],
    ['Australia/Lord_Howe', 'R20250406-014500.WAV', '2025-04-05T14:45:00Z', '2025-04-05T15:15:00Z'],
  ])('requires an explicit instant for the repeated time in %s', (timezone, fileName, first, second) => {
    vi.stubEnv('TZ', timezone)
    expect(new Date(first!).toLocaleString()).toBe(new Date(second!).toLocaleString())
    expect(recordingDirectoryStartTime(fileName!)).toBeUndefined()
  })

  it('keeps unambiguous times on both sides of a clock change and rejects the missing hour', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(recordingDirectoryStartTime('R20251102-003000.wav')).toBe(Date.parse('2025-11-02T04:30:00Z'))
    expect(recordingDirectoryStartTime('R20251102-023000.wav')).toBe(Date.parse('2025-11-02T07:30:00Z'))
    expect(recordingDirectoryStartTime('R20250309-023000.wav')).toBeUndefined()
  })

  it('previews an ambiguous file as time-required until the human supplies its actual instant', async () => {
    vi.stubEnv('TZ', 'America/New_York')
    const directoryPath = await mkdtemp(join(tmpdir(), 'recording-time-review-'))
    const fileName = 'R20251102-013000.WAV'
    const owner = { recordingImportUserId: async () => 42,
      recordingDirectorySnapshot: vi.fn(async () => ({ local: [], existingFileNames: [], owner: [] })) }
    try {
      await writeFile(join(directoryPath, fileName), new Uint8Array(100))
      const input = { directoryPath, recursive: false, ownership: 'self' as const }
      expect((await prepareRecordingDirectory(owner, new LocalRecordingDirectorySource(directoryPath), input)).preview[0]?.outcome).toBe('time_required')
      expect(owner.recordingDirectorySnapshot).toHaveBeenLastCalledWith([], 42, undefined)
      const startAtMillis = Date.parse('2025-11-02T06:30:00Z')
      expect((await prepareRecordingDirectory(owner, new LocalRecordingDirectorySource(directoryPath), { ...input,
        startTimes: [{ relativePath: fileName, startAtMillis }],
      })).preview[0]?.outcome).toBe('pending_upload')
      expect(owner.recordingDirectorySnapshot).toHaveBeenLastCalledWith([{ fileName, startAtMillis }], 42, undefined)
    } finally { await rm(directoryPath, { recursive: true, force: true }) }
  })
})
