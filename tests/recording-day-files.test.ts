import { describe, expect, it } from 'vitest'
import { mergeRecordingFiles, recordingFileDayBounds, recordingFileMatchesDay, type RecordingFile } from '../src/client/recordings/recording-day-files.js'

const day = new Date(2026, 9, 12).getTime()
const bounds = recordingFileDayBounds(day)
const file = (patch: Partial<RecordingFile> = {}): RecordingFile => ({ taskKey: 'one', sessionRef: 'ref', ownership: 'self', fileName: '会议.m4a', fileSize: 100, parsedSize: 100, durationMillis: 60000, startAtMillis: day, endAtMillis: day + 60000, progress: 1, status: 'completed', statusDetail: '', createdAtMillis: day, updatedAtMillis: day, ...patch })

describe('day file selection', () => {
  it('includes overlapping cross-day audio but excludes boundary-only overlap', () => {
    expect(recordingFileMatchesDay(file({ startAtMillis: day - 60000, endAtMillis: day + 60000 }), day, 'recorded')).toBe(true)
    expect(recordingFileMatchesDay(file({ startAtMillis: day - 60000, endAtMillis: day }), day, 'recorded')).toBe(false)
    expect(recordingFileMatchesDay(file({ startAtMillis: bounds.to, endAtMillis: bounds.to + 60000 }), day, 'recorded')).toBe(false)
  })
  it('separates recording date from cloud-entry date for backfilled uploads', () => {
    const old = file({ startAtMillis: day - 86400000, endAtMillis: day - 86340000 })
    expect(recordingFileMatchesDay(old, day, 'recorded')).toBe(false)
    expect(recordingFileMatchesDay(old, day, 'uploaded')).toBe(true)
    expect(recordingFileMatchesDay(file({ createdAtMillis: 0 }), day, 'uploaded')).toBe(false)
    expect(recordingFileMatchesDay(old, day, 'all')).toBe(true)
  })
  it('keeps different files with identical names and deduplicates by owner identity', () => {
    const first = file(), second = file({ taskKey: 'two', sessionRef: 'ref2' })
    const current = { ...first, kind: 'owner' as const, status: 'transcribing' as const }
    const merged = mergeRecordingFiles([first, second], [current])
    expect(merged).toHaveLength(2)
    expect(merged[0]?.status).toBe('transcribing')
  })
})
