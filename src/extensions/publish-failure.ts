import { ArkmePluginError, ArkmeUpstreamResponseError } from '../services/service.js'
import type { ArkmeExtensionPublishResult } from './types.js'

/** Explicit projection: never serialize arbitrary upstream bodies, signed URLs or source evidence. */
export function publishReceipt(value: unknown): ArkmeExtensionPublishResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.publish_session_id !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(record.publish_session_id)
    || typeof record.extension_id !== 'string' || typeof record.version !== 'string'
    || !['uploading', 'validating', 'published', 'rejected', 'audit_rejected', 'revoked', 'expired'].includes(String(record.status))) return undefined
  const result: ArkmeExtensionPublishResult = {
    publish_session_id: record.publish_session_id, extension_id: record.extension_id.slice(0, 128),
    version: record.version.slice(0, 128), status: record.status as ArkmeExtensionPublishResult['status'],
  }
  for (const key of ['phase', 'error_code', 'error_message', 'validation_error_code', 'validation_error_message'] as const) {
    if (typeof record[key] === 'string') result[key] = record[key].slice(0, 1000)
  }
  if (['uploading', 'running', 'failed', 'interrupted', 'published', 'rejected', 'audit_rejected', 'revoked', 'expired', 'unknown'].includes(String(record.execution_state))) result.execution_state = record.execution_state as NonNullable<ArkmeExtensionPublishResult['execution_state']>
  if (typeof record.can_resume === 'boolean') result.can_resume = record.can_resume
  for (const key of ['retry_after_millis', 'attempt_deadline', 'recovery_expires_at'] as const) {
    if (typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0) result[key] = record[key]
  }
  return result
}

export function publishFailure(error: unknown, receipt?: ArkmeExtensionPublishResult): ArkmePluginError {
  const known = error instanceof ArkmePluginError ? error : undefined
  const previous = known?.publishReceipt ?? (error instanceof ArkmeUpstreamResponseError ? publishReceipt(error.responseData) : undefined)
  const current = publishReceipt(receipt)
  const safe = current === undefined ? previous : { ...previous, ...current }
  return new ArkmePluginError(known?.code ?? 'extension-publish-incomplete',
    safe?.error_message || safe?.validation_error_message || (error instanceof Error ? error.message : '发布尚未完成，请查询发布记录'),
    false, known?.httpStatus ?? 503, { cause: error, ...(safe === undefined ? {} : { publishReceipt: safe }) })
}
