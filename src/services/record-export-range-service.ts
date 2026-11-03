import { createHash } from 'node:crypto'
import type { ArkmeExportSelection, ArkmeRangeExportPreview } from '../data-management.js'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

const ROOT = '/api/v1/records/export/range'
const invalid = () => new ArkmePluginError('record-export-range-invalid', '导出范围或任务状态已变化，请刷新后重试', false, 409)
export function exportObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  return raw as Record<string, unknown>
}
export function exportInteger(raw: unknown): number { if (!Number.isSafeInteger(raw) || (raw as number) < 0) throw invalid(); return raw as number }
export function exportSelection(raw: unknown): ArkmeExportSelection {
  const value = exportObject(raw)
  if (!['all', 'dates', 'incremental'].includes(value.mode as string) || typeof value.includeAttachments !== 'boolean'
    || typeof value.timeZone !== 'string' || value.timeZone.length > 100) throw invalid()
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format() } catch { throw invalid() }
  const result: ArkmeExportSelection = { mode: value.mode as ArkmeExportSelection['mode'], timeZone: value.timeZone, includeAttachments: value.includeAttachments }
  if (value.mode === 'dates') {
    if (typeof value.startDate !== 'string' || typeof value.endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(value.endDate) || value.startDate > value.endDate) throw invalid()
    for (const day of [value.startDate, value.endDate]) {
      const parsed = new Date(`${day}T00:00:00Z`)
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day || day < '1970-01-01' || day > '9998-12-31') throw invalid()
    }
    result.startDate = value.startDate; result.endDate = value.endDate
  } else if (value.startDate !== undefined || value.endDate !== undefined) throw invalid()
  return result
}
export function wireExportSelection(selection: ArkmeExportSelection, orderKind: 1 | 2) {
  return { mode: selection.mode, ...(selection.mode === 'dates' ? { start_date: selection.startDate, end_date: selection.endDate } : {}), time_zone: selection.timeZone, include_attachments: selection.includeAttachments, order_kind: orderKind }
}

/** A v2 range is never downgraded to v1. Checkpoints are owner/host facts; the
 * browser never supplies a device ID or infers a checkpoint from wall time. */
export class RecordExportRangeService {
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime) { this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid) }
  async session(scope: string) {
    const session = await this.runtime.requireSession()
    if (scope !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('record-export-account-changed', '账号已切换，请重新打开导出', false, 409)
    return session
  }
  async device(scope: string): Promise<string> {
    await this.session(scope)
    return createHash('sha256').update(`${scope}:${await this.runtime.stateStore.uniqueCode()}`).digest('hex')
  }
  async post(scope: string, path: string, body: Record<string, unknown>, signal?: AbortSignal, read = false) {
    const session = await this.session(scope)
    const result = await this.runtime.authenticatedPost<unknown>(`${ROOT}/${path}`, body, session, signal,
      read ? { lane: 'interactive-read', bypassCache: true, cacheMs: 0 } : undefined)
    const current = await this.session(scope)
    if (current.refreshToken !== session.refreshToken) throw invalid()
    return exportObject(result)
  }
  async supported(scope: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const value = await this.post(scope, 'capabilities', {}, signal, true)
      return value.protocol_version === 2 && value.date_range === true && value.incremental === true && value.explicit_saved_confirmation === true
    } catch (error) {
      if (error instanceof ArkmePluginError && (error.upstreamStatus === 404 || error.httpStatus === 404)) return false
      throw error
    }
  }
  async state(scope: string, signal?: AbortSignal, includeAttachments = true) {
    const value = await this.post(scope, 'state', { device_id: await this.device(scope), include_attachments: includeAttachments }, signal, true)
    return { chainVersion: exportInteger(value.version), savedAtMillis: exportInteger(value.saved_at) }
  }
  async preview(scope: string, raw: unknown, orderKind: 1 | 2, signal?: AbortSignal): Promise<ArkmeRangeExportPreview> {
    const selection = exportSelection(raw)
    if (![1, 2].includes(orderKind)) throw invalid()
    const value = await this.post(scope, 'prepare', { device_id: await this.device(scope), selection: wireExportSelection(selection, orderKind) }, signal, true)
    if (value.protocol_version !== 2 || typeof value.can_export !== 'boolean' || typeof value.baseline_required !== 'boolean') throw invalid()
    const chain = value.chain ? exportObject(value.chain) : undefined, plan = value.plan ? exportObject(value.plan) : undefined
    if (value.can_export && !plan || plan && (typeof plan.preview_uid !== 'string' || !plan.preview_uid || plan.preview_uid.length > 100 || typeof plan.selection_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(plan.selection_fingerprint))) throw invalid()
    if (plan && (JSON.stringify(exportObject(plan.selection)) !== JSON.stringify(wireExportSelection(selection, orderKind)))) {
      // Compare fields rather than object order; JSON encoders need not retain it.
      const received = exportObject(plan.selection), expected = wireExportSelection(selection, orderKind)
      if (Object.entries(expected).some(([key, val]) => received[key] !== val)) throw invalid()
    }
    return { accountScope: scope, supported: true, canExport: value.can_export, baselineRequired: value.baseline_required,
      message: typeof value.quota_message === 'string' ? value.quota_message : '',
      ...(plan ? { previewUid: String(plan.preview_uid), selectionFingerprint: String(plan.selection_fingerprint) } : {}),
      recordCount: plan ? exportInteger(plan.record_count) : 0, imageCount: plan ? exportInteger(plan.total_image_count) : 0, voiceCount: plan ? exportInteger(plan.total_voice_count) : 0,
      newCount: plan ? exportInteger(plan.new_count) : 0, updatedCount: plan ? exportInteger(plan.updated_count) : 0, removedCount: plan ? exportInteger(plan.removed_count) : 0,
      chainVersion: chain ? exportInteger(chain.version) : 0, savedAtMillis: chain ? exportInteger(chain.saved_at) : 0 }
  }
  async confirmation(scope: string, fileRef: string, previewUid: string, digest: string, size: number) {
    await this.session(scope)
    return this.codec.seal('arkme-export-save-v2', { scope, fileRef, previewUid, digest, size, expires: Date.now() + 60 * 60_000 })
  }
  async confirmSaved(scope: string, ref: string, verifyFile: (fileRef: string, digest: string, size: number) => Promise<void>, signal?: AbortSignal) {
    await this.session(scope)
    const value = await this.codec.open('arkme-export-save-v2', ref)
    if (value.scope !== scope || typeof value.expires !== 'number' || value.expires < Date.now() || typeof value.fileRef !== 'string'
      || typeof value.previewUid !== 'string' || typeof value.digest !== 'string' || typeof value.size !== 'number') throw invalid()
    await verifyFile(value.fileRef, value.digest, value.size)
    const result = await this.post(scope, 'saved', { preview_uid: value.previewUid, artifact_sha256: value.digest, artifact_size: value.size, user_confirmed_saved: true }, signal)
    return { accountScope: scope, chainVersion: exportInteger(result.version), savedAtMillis: exportInteger(result.saved_at) }
  }
}
