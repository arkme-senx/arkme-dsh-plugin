import type { ArkmeDeletedRecordPage, ArkmeExportPreflight } from '../data-management.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function invalid() { return new ArkmePluginError('data-management-contract-invalid', '数据格式暂时无法确认，请重试', true, 502) }
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid()
  return value
}
const DELETED_RETENTION_MILLIS = 30 * 24 * 60 * 60 * 1000
function positiveTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
function lifecycle(value: unknown): 'deleted' | 'excluded' | 'unknown' {
  // record_core uses service statuses, not the old local Record.status enum.
  if (value === 2) return 'deleted'
  if (value === 1 || value === 4) return 'excluded'
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (name === 'deleted') return 'deleted'
  if (['active', 'normal', 'restored', 'purged'].includes(name)) return 'excluded'
  return 'unknown'
}
export function parseDeletedRecords(raw: unknown, accountScope: string, nowMillis = Date.now()): ArkmeDeletedRecordPage {
  const envelope = object(raw)
  const rows = envelope.items ?? envelope.records ?? envelope.list ?? envelope.data
  if (!Array.isArray(rows)) throw invalid()
  let unverifiedCount = 0
  const items = rows.flatMap(value => {
    const row = object(value)
    const core = object(row.record_core ?? row.record ?? row)
    const recordUid = text(core.record_uid).trim()
    if (!recordUid) throw invalid()
    const status = lifecycle(core.status)
    if (status === 'excluded') return []
    if (status === 'unknown') { unverifiedCount++; return [] }
    const version = integer(core.version)
    const sendAtMillis = integer(core.send_at ?? row.send_at ?? core.create_at)
    const explicitDeadline = [row, core].flatMap(data => [data.will_real_delete_after, data.willRealDeleteAfter,
      data.will_real_delete_after_millis, data.willRealDeleteAfterMillis, data.real_delete_after, data.realDeleteAfter])
      .map(positiveTimestamp).find(value => value !== undefined)
    const updatedAt = positiveTimestamp(core.update_at ?? core.updated_at ?? core.send_at)
    const recoverableUntilMillis = explicitDeadline ?? (updatedAt === undefined ? undefined : updatedAt + DELETED_RETENTION_MILLIS)
    if (version === 0 || recoverableUntilMillis === undefined) { unverifiedCount++; return [] }
    if (recoverableUntilMillis <= nowMillis) return []
    return [{ recordUid, version, title: text(core.title), text: text(core.text_content), sendAtMillis, recoverableUntilMillis }]
  })
  return { accountScope, items, mayHaveMore: envelope.has_more === true || rows.length >= 50, unverifiedCount }
}

/** Reuse the Flutter record-service contract, always bound to the current account.
 * Browsing never restores or permanently purges anything (including expired rows). */
export class DataManagementService {
  constructor(private readonly runtime: ServiceRuntime) {}
  private async session(scope: string) {
    const session = await this.runtime.requireSession()
    if (scope !== `${this.runtime.config.environment}:${session.userId}`) {
      throw new ArkmePluginError('data-management-account-changed', '账号已切换，请重新打开数据管理', false, 409)
    }
    return session
  }
  async deleted(scope: string, signal?: AbortSignal): Promise<ArkmeDeletedRecordPage> {
    const session = await this.session(scope)
    const raw = await this.runtime.authenticatedPost<unknown>('/api/v1/records/deleted/list', { limit: 50 }, session, signal, { lane: 'interactive-read' })
    await this.session(scope)
    return parseDeletedRecords(raw, scope)
  }
  async exportPreflight(scope: string, signal?: AbortSignal): Promise<ArkmeExportPreflight> {
    const session = await this.session(scope)
    const [preflightResponse, latestResponse] = await Promise.all([
      this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/export/session/preflight', { order_kind: 1, hide_record_privacy_lock: true }, session, signal, { lane: 'interactive-read' }),
      this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/export/session/latest', {}, session, signal, { lane: 'interactive-read' }),
    ])
    await this.session(scope)
    const raw = object(preflightResponse), latest = object(latestResponse)
    if (typeof raw.can_export !== 'boolean') throw invalid()
    return { accountScope: scope, canExport: raw.can_export, recordCount: integer(raw.record_count), voiceCount: integer(raw.total_voice_count), imageCount: integer(raw.total_image_count), message: text(raw.quota_message) || text(raw.blocked_reason), latestAtMillis: integer(latest.latest_at) }
  }
  async recover(scope: string, recordUid: string, version: number) {
    if (!recordUid.trim() || integer(version) <= 0) throw invalid()
    const latest = await this.deleted(scope)
    const record = latest.items.find(item => item.recordUid === recordUid)
    if (!record || record.version !== version || record.recoverableUntilMillis === undefined || record.recoverableUntilMillis <= Date.now()) {
      throw new ArkmePluginError('data-management-record-changed', '记录状态已变化或无法确认可恢复，请刷新最近删除列表。', false, 409)
    }
    const session = await this.session(scope)
    const raw = await this.runtime.authenticatedPost<unknown>('/api/v1/records/recover', { record_uid: recordUid, version }, session)
    await this.session(scope)
    const envelope = object(raw), core = object(envelope.record_core ?? envelope.record ?? envelope)
    if (core.record_uid !== recordUid) throw invalid()
    return { accountScope: scope, recordUid }
  }
}
