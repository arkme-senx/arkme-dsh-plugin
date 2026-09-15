import { createHmac, timingSafeEqual } from 'node:crypto'
import { ArkmePluginError } from './services/service.js'
export interface RecordDeletionReference {
  userId: number
  sourceKind: 'private_chat' | 'group_chat' | 'send_to_self' | 'default_category' | 'topic'
  sourceOwnerRef: string
  recordUid: string
  recordVersion: number
}
const prefix = 'arkme-record-delete-v1'
const invalid = () => new ArkmePluginError('record-delete-reference-invalid', '删除引用已失效，请刷新后重新选择', false, 409)
export function sealRecordDeletionRef(ref: RecordDeletionReference, key: string): string {
  const payload = Buffer.from(JSON.stringify(ref)).toString('base64url')
  return `${prefix}.${payload}.${createHmac('sha256', key).update(`${prefix}.${payload}`).digest('base64url')}`
}
export function openRecordDeletionRef(value: string, key: string): RecordDeletionReference {
  if (typeof value !== 'string' || value.length > 2048) throw invalid()
  const [kind, payload, signature, extra] = value.split('.')
  if (kind !== prefix || !payload || !signature || extra !== undefined) throw invalid()
  const actual = Buffer.from(signature, 'base64url')
  const expected = createHmac('sha256', key).update(`${prefix}.${payload}`).digest()
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid()
  let ref: RecordDeletionReference
  try { ref = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RecordDeletionReference } catch { throw invalid() }
  if (!ref || !Number.isSafeInteger(ref.userId) || ref.userId <= 0 || !Number.isSafeInteger(ref.recordVersion) || ref.recordVersion <= 0
    || !['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'].includes(ref.sourceKind)
    || typeof ref.sourceOwnerRef !== 'string' || !ref.sourceOwnerRef.trim() || typeof ref.recordUid !== 'string' || !ref.recordUid.trim()) throw invalid()
  return ref
}

/** Only authoritative Record snapshots can grant deletion; missing versions never fall back to a relation version. */
export function recordDeletionCapability(input: {
  userId: number; sourceKind: string; sourceOwnerRef: string; recordUid: string
  recordVersion: number; recordOwnerUserId: number; isMe: boolean; status: number
}, key: string): { recordDeletionRef?: string } {
  if (!input.isMe || input.recordOwnerUserId !== input.userId || input.status !== 1 || !input.recordUid.trim()
    || !Number.isSafeInteger(input.recordVersion) || input.recordVersion <= 0
    || !['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'].includes(input.sourceKind)) return {}
  return { recordDeletionRef: sealRecordDeletionRef({ userId: input.userId, sourceKind: input.sourceKind as RecordDeletionReference['sourceKind'],
    sourceOwnerRef: input.sourceOwnerRef, recordUid: input.recordUid, recordVersion: input.recordVersion }, key) }
}
