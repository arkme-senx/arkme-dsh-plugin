import { describe, expect, it } from 'vitest'
import type { RecordingImportSnapshot } from '../src/client/api.js'
import type { PublicRecordingImportJob, PublicRecordingImportOwnerTask } from '../src/recording-import-shared.js'
import { hasRecordingImportCalendarChange } from '../src/client/recordings/ArkmeRecordingImportDialog.js'

function snapshot(importRef: string, phase: PublicRecordingImportJob['phase']): PublicRecordingImportJob {
  return {
    kind: 'local', importRef, phase, revision: 1, ownership: 'self', fileName: 'meeting.m4a', fileSize: 10,
    durationMillis: 1_000, progress: phase === 'accepted' ? 1 : 0,
    startAtMillis: 1, endAtMillis: 1_001,
    status: phase === 'accepted' ? 'accepted' : 'uploading', statusDetail: phase === 'accepted' ? 'Audio 已接收' : '上传中',
    createdAtMillis: 1, updatedAtMillis: 1,
  }
}

function ownerSnapshot(taskKey: string): PublicRecordingImportOwnerTask {
  return {
    kind: 'owner', taskKey, sessionRef: `session-${taskKey}`, ownership: 'self',
    fileName: 'meeting.m4a', fileSize: 10, parsedSize: 10, durationMillis: 1_000,
    startAtMillis: 1, endAtMillis: 1_001, progress: 1,
    status: 'processing', statusDetail: '处理中', processingDurationMillis: 1,
    createdAtMillis: 1, updatedAtMillis: 1,
  }
}

describe('recording import job projection refresh', () => {
  it('does not treat a local transfer phase as Audio owner acceptance', () => {
    expect(hasRecordingImportCalendarChange(
      [snapshot('active', 'uploading')],
      [snapshot('active', 'accepted')],
    )).toBe(false)
  })

  it('refreshes the calendar when a new Audio owner task appears', () => {
    const previous: RecordingImportSnapshot[] = [snapshot('uploading', 'uploading'), ownerSnapshot('existing')]
    const next: RecordingImportSnapshot[] = [ownerSnapshot('existing'), ownerSnapshot('new')]

    expect(hasRecordingImportCalendarChange(previous, next)).toBe(true)
    expect(hasRecordingImportCalendarChange(next, next)).toBe(false)
  })

  it('refreshes the calendar when an active local orchestration job leaves the current list', () => {
    expect(hasRecordingImportCalendarChange(
      [snapshot('active', 'finalizing')],
      [],
    )).toBe(true)
    expect(hasRecordingImportCalendarChange(
      [snapshot('failed', 'failed')],
      [],
    )).toBe(false)
  })

  it('refreshes the calendar when a cross-device Audio owner task leaves the active projection', () => {
    expect(hasRecordingImportCalendarChange(
      [ownerSnapshot('remote-active')],
      [],
    )).toBe(true)
  })
})
