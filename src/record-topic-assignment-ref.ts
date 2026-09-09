import { createHmac, timingSafeEqual } from 'node:crypto'
import { ArkmePluginError } from './services/service.js'

/** Observed personal-topic membership, distinct from the containing aggregate source. */
export interface RecordTopicAssignmentReference {
  userId: number
  sourceKind: 'send_to_self' | 'default_category' | 'topic'
  sourceOwnerRef: string
  recordUid: string
  sourceTopicUid: string
}
const invalid = () => new ArkmePluginError('record-topic-reference-invalid', '快记归属引用已失效，请刷新后重新选择', false, 409)
const prefix = 'arkme-record-topic-v1'

export function sealRecordTopicAssignmentRef(reference: RecordTopicAssignmentReference, key: string): string {
  const payload = Buffer.from(JSON.stringify(reference)).toString('base64url')
  return `${prefix}.${payload}.${createHmac('sha256', key).update(`${prefix}.${payload}`).digest('base64url')}`
}

export function openRecordTopicAssignmentRef(value: string, key: string): RecordTopicAssignmentReference {
  if (typeof value !== 'string' || value.length > 2048) throw invalid()
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== prefix) throw invalid()
  const payload = parts[1]!
  const signature = Buffer.from(parts[2]!, 'base64url')
  const expected = createHmac('sha256', key).update(`${prefix}.${payload}`).digest()
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw invalid()
  let parsed: RecordTopicAssignmentReference
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RecordTopicAssignmentReference }
  catch { throw invalid() }
  if (!parsed || !Number.isSafeInteger(parsed.userId) || parsed.userId <= 0
    || !['send_to_self', 'default_category', 'topic'].includes(parsed.sourceKind)
    || typeof parsed.sourceOwnerRef !== 'string' || parsed.sourceOwnerRef.trim() === ''
    || typeof parsed.recordUid !== 'string' || parsed.recordUid.trim() === ''
    || typeof parsed.sourceTopicUid !== 'string') throw invalid()
  return parsed
}
