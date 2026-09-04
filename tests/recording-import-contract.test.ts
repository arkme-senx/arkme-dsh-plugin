import { describe, expect, it } from 'vitest'
import {
  MAX_RECORDING_IMPORT_BYTES,
  MAX_RECORDING_IMPORT_DURATION_MILLIS,
  advanceRecordingImportJob,
  recordingImportFileKind,
  recordingImportCanonicalMimeType,
  toPublicRecordingImportJob,
  type RecordingImportJob,
} from '../src/recording-import-contract.js'

function job(overrides: Partial<RecordingImportJob> = {}): RecordingImportJob {
  return {
    jobId: 'job-1',
    userId: 42,
    revision: 1,
    phase: 'prepared',
    fileName: 'meeting.m4a',
    mimeType: 'audio/mp4',
    fileSize: 1024,
    durationMillis: 60_000,
    sha256: 'a'.repeat(64),
    startAtMillis: 1_725_000_000_000,
    belongUserId: 42,
    sourceHandle: '/private/job-1.upload',
    uploadedBytes: 0,
    createdAtMillis: 1_725_000_000_100,
    updatedAtMillis: 1_725_000_000_100,
    ...overrides,
  }
}

describe('recording import contract', () => {
  it.each([
    ['voice.wav', 'audio/wav', 'wav'],
    ['VOICE.WAV', 'audio/x-wav', 'wav'],
    ['meeting.mp3', 'audio/mpeg', 'mp3'],
    ['meeting.mp3', 'audio/mp3', 'mp3'],
    ['memo.m4a', 'audio/mp4', 'm4a'],
    ['memo.m4a', '', 'm4a'],
    ['memo.m4a', 'application/octet-stream', 'm4a'],
  ] as const)('accepts the desktop recording formats: %s', (fileName, mimeType, expected) => {
    expect(recordingImportFileKind({
      fileName,
      mimeType,
      fileSize: MAX_RECORDING_IMPORT_BYTES,
      durationMillis: MAX_RECORDING_IMPORT_DURATION_MILLIS,
    })).toBe(expected)
  })

  it('rejects an extension and MIME mismatch before any owner write', () => {
    expect(() => recordingImportFileKind({
      fileName: 'meeting.mp3',
      mimeType: 'audio/mp4',
      fileSize: 1024,
      durationMillis: 10_000,
    })).toThrowError(/格式与文件内容不一致/)
  })

  it('normalizes Browser MIME hints before remote upload', () => {
    expect(recordingImportCanonicalMimeType('wav')).toBe('audio/wav')
    expect(recordingImportCanonicalMimeType('mp3')).toBe('audio/mpeg')
    expect(recordingImportCanonicalMimeType('m4a')).toBe('audio/mp4')
  })

  it('rejects files beyond the desktop size and duration boundary', () => {
    expect(MAX_RECORDING_IMPORT_DURATION_MILLIS).toBe(10 * 60 * 60 * 1_000)
    expect(() => recordingImportFileKind({
      fileName: 'meeting.wav', mimeType: 'audio/wav',
      fileSize: MAX_RECORDING_IMPORT_BYTES + 1, durationMillis: 10_000,
    })).toThrowError(/1 GiB/)
    expect(() => recordingImportFileKind({
      fileName: 'meeting.wav', mimeType: 'audio/wav',
      fileSize: 1024, durationMillis: MAX_RECORDING_IMPORT_DURATION_MILLIS + 1,
    })).toThrowError(/10 小时/)
  })

  it('advances only from the current revision and legal phase', () => {
    const uploading = advanceRecordingImportJob(job(), {
      expectedRevision: 1,
      phase: 'uploading',
      nowMillis: 1_725_000_000_200,
    })
    expect(uploading).toMatchObject({ phase: 'uploading', revision: 2, updatedAtMillis: 1_725_000_000_200 })
    expect(() => advanceRecordingImportJob(uploading, {
      expectedRevision: 1, phase: 'finalizing', nowMillis: 1_725_000_000_300,
    })).toThrowError(/任务状态已变化/)
    expect(() => advanceRecordingImportJob(job({ phase: 'accepted' }), {
      expectedRevision: 1, phase: 'uploading', nowMillis: 1_725_000_000_300,
    })).toThrowError(/不允许从 accepted/)
  })

  it('never exposes local paths or owner checkpoints to the browser snapshot', () => {
    const publicJob = toPublicRecordingImportJob(job({
      phase: 'uploading', uploadedBytes: 512, sessionId: 'session-secret', childId: 'child-secret', childFinished: true,
    }), 'opaque-ref')
    expect(publicJob).toEqual(expect.objectContaining({
      importRef: 'opaque-ref', phase: 'uploading', progress: 0.5, ownership: 'self',
      startAtMillis: 1_725_000_000_000,
      endAtMillis: 1_725_000_060_000,
    }))
    expect(publicJob).not.toHaveProperty('sourceHandle')
    expect(publicJob).not.toHaveProperty('sessionId')
    expect(publicJob).not.toHaveProperty('childId')
    expect(publicJob).not.toHaveProperty('childFinished')
    expect(publicJob).not.toHaveProperty('processingDurationMillis')
    expect(JSON.stringify(publicJob)).not.toContain('/private/')
  })

  it('projects ownership as a category without exposing the owner user id', () => {
    const publicJob = toPublicRecordingImportJob(job({ belongUserId: 0 }), 'opaque-ref')

    expect(publicJob.ownership).toBe('other')
    expect(publicJob).not.toHaveProperty('belongUserId')
    expect(JSON.stringify(publicJob)).not.toContain('42')
  })

  it('keeps local Audio acceptance distinct from owner processing state', () => {
    const publicJob = toPublicRecordingImportJob(job({ phase: 'accepted' }), 'opaque-ref')

    expect(publicJob).toMatchObject({
      phase: 'accepted',
      status: 'accepted',
      statusDetail: 'Audio 已接收',
    })
  })
})
