import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto'

import { RecordingImportContractError } from './recording-import-contract.js'

export interface RecordingImportRefPayload {
  jobId: string
  userId: number
}

function recordingImportRefKey(signingKey: string): Buffer {
  return createHash('sha256').update(signingKey).update('\0arkme-recording-import-v1').digest()
}

export function sealRecordingImportRef(payload: RecordingImportRefPayload, signingKey: string): string {
  const encoded = JSON.stringify(payload)
  const key = recordingImportRefKey(signingKey)
  const iv = createHmac('sha256', key).update(encoded).digest().subarray(0, 12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(encoded, 'utf8'), cipher.final()])
  return `arkme-recording-import-v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

export function openRecordingImportRef(
  importRef: string,
  currentUserId: number,
  signingKey: string,
): RecordingImportRefPayload {
  try {
    const parts = importRef.split('.')
    if (parts.length !== 4 || parts[0] !== 'arkme-recording-import-v1') throw new Error('invalid shape')
    const decipher = createDecipheriv(
      'aes-256-gcm', recordingImportRefKey(signingKey), Buffer.from(parts[1] ?? '', 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(parts[3] ?? '', 'base64url'))
    const encoded = Buffer.concat([
      decipher.update(Buffer.from(parts[2] ?? '', 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    const payload = JSON.parse(encoded) as Partial<RecordingImportRefPayload>
    if (typeof payload.jobId !== 'string' || !Number.isSafeInteger(payload.userId) || payload.userId! <= 0) {
      throw new Error('invalid payload')
    }
    if (payload.userId !== currentUserId) {
      throw new RecordingImportContractError('recording-import-account-mismatch', '录音导入任务不属于当前账号')
    }
    return { jobId: payload.jobId, userId: payload.userId }
  } catch (error) {
    if (error instanceof RecordingImportContractError) throw error
    throw new RecordingImportContractError('recording-import-ref-invalid', '录音导入任务引用无效')
  }
}
