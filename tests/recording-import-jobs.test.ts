import { describe, expect, it } from 'vitest'
import type { RecordingImportSnapshot } from '../src/client/api.js'
import { hasNewlyAcceptedRecordingImport } from '../src/client/recordings/ArkmeRecordingImportJobs.js'

function snapshot(importRef: string, phase: RecordingImportSnapshot['phase']): RecordingImportSnapshot {
  return {
    importRef, phase, revision: 1, fileName: 'meeting.m4a', fileSize: 10,
    durationMillis: 1_000, progress: phase === 'accepted' ? 1 : 0,
    createdAtMillis: 1, updatedAtMillis: 1,
  }
}

describe('recording import job projection refresh', () => {
  it('refreshes only when a previously observed job becomes accepted', () => {
    expect(hasNewlyAcceptedRecordingImport(
      [snapshot('old', 'accepted'), snapshot('active', 'uploading')],
      [snapshot('old', 'accepted'), snapshot('active', 'accepted')],
    )).toBe(true)
    expect(hasNewlyAcceptedRecordingImport([], [snapshot('old', 'accepted')])).toBe(false)
    expect(hasNewlyAcceptedRecordingImport(
      [snapshot('old', 'accepted')], [snapshot('old', 'accepted')],
    )).toBe(false)
  })
})
