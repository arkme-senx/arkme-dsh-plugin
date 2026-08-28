import { describe, expect, it } from 'vitest'
import {
  MAX_RECORDING_IMPORT_BYTES,
  MAX_RECORDING_IMPORT_DURATION_MILLIS,
  advanceRecordingImportJob,
  openRecordingImportRef,
  recordingImportFileKind,
  sealRecordingImportRef,
  toPublicRecordingImportJob,
  type RecordingImportJob,
} from '../src/recording-import-contract.js'

function job(overrides: Partial<RecordingImportJob> = {}): RecordingImportJob {
  return {
    jobId: 'job-1',
    userId: 42,
    revision: 1,
    phase: 'validating',
    fileName: 'meeting.m4a',
    mimeType: 'audio/mp4',
    fileSize: 1024,
    durationMillis: 60_000,
    sha256: 'a'.repeat(64),
    startAtMillis: 1_725_000_000_000,
    belongUserId: 42,
    temporaryPath: '/private/job-1.upload',
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
    ['memo.m4a', 'audio/mp4', 'm4a'],
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

  it('rejects files beyond the desktop size and duration boundary', () => {
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
    const prepared = advanceRecordingImportJob(job(), {
      expectedRevision: 1,
      phase: 'prepared',
      nowMillis: 1_725_000_000_200,
    })
    expect(prepared).toMatchObject({ phase: 'prepared', revision: 2, updatedAtMillis: 1_725_000_000_200 })
    expect(() => advanceRecordingImportJob(prepared, {
      expectedRevision: 1, phase: 'uploading', nowMillis: 1_725_000_000_300,
    })).toThrowError(/任务状态已变化/)
    expect(() => advanceRecordingImportJob(job({ phase: 'accepted' }), {
      expectedRevision: 1, phase: 'uploading', nowMillis: 1_725_000_000_300,
    })).toThrowError(/不允许从 accepted/)
  })

  it('seals the job identity to the current account', () => {
    const ref = sealRecordingImportRef({ jobId: 'job-1', userId: 42 }, 'secret')
    expect(ref.split('.')).toHaveLength(4)
    for (const segment of ref.split('.').slice(1)) {
      expect(() => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))).toThrow()
    }
    expect(openRecordingImportRef(ref, 42, 'secret')).toEqual({ jobId: 'job-1', userId: 42 })
    expect(() => openRecordingImportRef(ref, 77, 'secret')).toThrowError(/不属于当前账号/)
    expect(() => openRecordingImportRef(`${ref}x`, 42, 'secret')).toThrowError(/引用无效/)
  })

  it('never exposes local paths or owner checkpoints to the browser snapshot', () => {
    const publicJob = toPublicRecordingImportJob(job({
      phase: 'uploading', uploadedBytes: 512, sessionId: 'session-secret', childId: 'child-secret', childFinished: true,
    }), 'opaque-ref')
    expect(publicJob).toEqual(expect.objectContaining({ importRef: 'opaque-ref', phase: 'uploading', progress: 0.5 }))
    expect(publicJob).not.toHaveProperty('temporaryPath')
    expect(publicJob).not.toHaveProperty('sessionId')
    expect(publicJob).not.toHaveProperty('childId')
    expect(publicJob).not.toHaveProperty('childFinished')
    expect(JSON.stringify(publicJob)).not.toContain('/private/')
  })
})
