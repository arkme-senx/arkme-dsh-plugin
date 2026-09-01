import { describe, expect, it } from 'vitest'

import { openRecordingImportRef, sealRecordingImportRef } from '../src/recording-import-ref.js'

describe('recording import refs', () => {
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
})
