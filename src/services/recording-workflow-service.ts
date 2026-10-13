import { projectRecordingVersions } from '../recording-presentation.js'
import type { ArkmeRecordingVersion } from '../types.js'
import { EMPTY_RECORDING_WORKFLOW, type RecordingWorkflowNotice, type RecordingWorkflowPage, type RecordingWorkflowState } from '../recording-workflow-contract.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

function invalid(): never { throw new ArkmePluginError('recording-workflow-invalid', '录音通知数据不完整，请重试', true, 502) }
function text(value: unknown): string { if (typeof value !== 'string') invalid(); return value }
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value }
function id(value: unknown): string { const result = text(value); if (!/^[a-zA-Z0-9_-]{8,80}$/.test(result)) invalid(); return result }
function state(value: unknown): RecordingWorkflowState {
  if (!['completed', 'partial', 'failed', 'skipped'].includes(String(value))) invalid()
  return value as RecordingWorkflowState
}
function projection(value: unknown) {
  const raw = objectValue(value)
  const result = { state: raw.state === 'pending' ? 'pending' as const : state(raw.state), ...(raw.version_id === undefined ? {} : { versionId: text(raw.version_id) }) }
  if (result.state === 'completed' && !result.versionId) invalid()
  return result
}
export function recordingWorkflowNotice(value: unknown): RecordingWorkflowNotice {
  const raw = objectValue(value)
  if (raw.stage !== 'processing' && raw.stage !== 'analysis') invalid()
  if (!Array.isArray(raw.days) || raw.days.length > 366) invalid()
  const days = raw.days.map(value => {
    const day = objectValue(value), date = text(day.date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
      || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) invalid()
    const dateStamp = day.date_stamp, endStamp = count(day.end_stamp)
    if (typeof dateStamp !== 'number' || !Number.isSafeInteger(dateStamp) || dateStamp < -26 * 3600_000 || endStamp <= 0 || endStamp <= dateStamp || endStamp - dateStamp > 26 * 3600_000) invalid()
    return { date, dateStamp, endStamp, summary: projection(day.summary), timeline: projection(day.timeline) }
  })
  if (new Set(days.map(day => day.date)).size !== days.length) invalid()
  const result: RecordingWorkflowNotice = {
    id: id(raw.id), batchId: id(raw.batch_id), timeZone: text(raw.time_zone), stage: raw.stage, state: state(raw.state),
    fileCount: count(raw.file_count), completedCount: count(raw.completed_count), failedCount: count(raw.failed_count),
    atMillis: count(raw.updated_at ?? raw.created_at), readAtMillis: count(raw.read_at), message: text(raw.message), days,
  }
  try { new Intl.DateTimeFormat('en', { timeZone: result.timeZone }) } catch { invalid() }
  if (!result.timeZone) invalid()
  if (!result.fileCount || !result.atMillis || result.completedCount + result.failedCount > result.fileCount
    || (result.stage === 'processing' && result.state === 'completed' && result.completedCount !== result.fileCount)
    || (result.stage === 'analysis' && days.some(day => day.summary.state === 'pending' || day.timeline.state === 'pending'))
    || (result.stage === 'analysis' && result.state === 'completed' && (!days.length || days.some(day => day.summary.state !== 'completed' || day.timeline.state !== 'completed')))) invalid()
  return result
}
export function recordingWorkflowPage(value: unknown): RecordingWorkflowPage {
  const raw = objectValue(value)
  if (raw.supported === false) return { ...EMPTY_RECORDING_WORKFLOW }
  if (raw.supported !== true || !Array.isArray(raw.items) || raw.items.length > 50) invalid()
  const result: RecordingWorkflowPage = {
    supported: true, items: raw.items.map(recordingWorkflowNotice), total: count(raw.total), unreadCount: count(raw.unread_count),
    nextCursor: text(raw.next_cursor), throughSequence: text(raw.through_sequence),
    ...(raw.latest == null ? {} : { latest: recordingWorkflowNotice(raw.latest) }),
  }
  if (result.unreadCount > result.total || result.items.length > result.total
    || new Set(result.items.map(item => item.id)).size !== result.items.length
    || (result.total > 0 && (!result.latest || !result.throughSequence))) invalid()
  return result
}

export class RecordingWorkflowService {
  constructor(private readonly runtime: ServiceRuntime) {}
  async request(input: Record<string, unknown>, signal?: AbortSignal): Promise<RecordingWorkflowPage | { supported: boolean } | { version: ArkmeRecordingVersion | null } | void> {
    const session = await this.runtime.requireSession()
    const scope = `${this.runtime.config.environment}:${session.userId}`
    const current = async () => {
      const active = await this.runtime.accountScopedSession()
      if (signal?.aborted || active?.userId !== session.userId || active.refreshToken !== session.refreshToken) {
        throw new ArkmePluginError('recording-workflow-account-changed', '账号已变化，请重试', false, 409)
      }
    }
    const operation = input.operation
    if (operation === 'version') {
      if (input.kind !== 'summary' && input.kind !== 'timeline') invalid()
      const versionId = text(input.versionId)
      if (!/^[a-f0-9]{24}$/.test(versionId)) invalid()
      const raw = await this.runtime.authenticatedAudioPost<Record<string, unknown>>('/api/v1/summary/get-by-ids', { ids: [versionId] }, session, signal, { lane: 'interactive-read', bypassCache: true })
      await current()
      if (!Array.isArray(raw.audio_summary_ls)) invalid()
      const record = raw.audio_summary_ls.find(item => objectValue(item).id === versionId)
      if (record === undefined) return { version: null }
      const version = projectRecordingVersions({ audio_summary_ls: [record] }, input.kind)[0]
      if (!version) invalid()
      if (!version.selectable) throw new ArkmePluginError('recording-workflow-version-unreadable', '该版本的内容暂时无法读取，请稍后重新读取', true, 502)
      return { version }
    }
    let suffix: string, body: Record<string, unknown>
    if (operation === 'capabilities') { suffix = 'capabilities'; body = {} }
    else if (operation === 'query') {
      suffix = 'notifications/query'; body = { cursor: input.cursor === undefined ? '' : text(input.cursor), limit: 50 }
      if (String(body.cursor).length > 2048) invalid()
    } else if (operation === 'read') {
      if (input.accountKey !== scope) throw new ArkmePluginError('recording-workflow-account-changed', '账号已变化，请重试', false, 409)
      suffix = 'notifications/read'
      if (input.throughSequence !== undefined) {
        if (input.ids !== undefined || !text(input.throughSequence) || text(input.throughSequence).length > 2048) invalid()
        body = { through_sequence: input.throughSequence }
      } else {
        if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 50) invalid()
        body = { ids: input.ids.map(id) }
      }
    } else invalid()
    try {
      const raw = await this.runtime.authenticatedAudioPost<unknown>(`/api/v1/audio/import-batches/${suffix}`, body, session, signal,
        { lane: operation === 'read' ? 'write' : 'interactive-read', bypassCache: true })
      await current()
      if (operation === 'capabilities') {
        const value = objectValue(raw)
        if (typeof value.supported !== 'boolean') invalid()
        return { supported: value.supported }
      }
      if (operation === 'query') {
        const result = recordingWorkflowPage(raw)
        if (result.nextCursor && result.nextCursor === body.cursor) invalid()
        return { ...result, accountKey: scope }
      }
      if (objectValue(raw).acknowledged !== true) invalid()
    } catch (error) {
      await current()
      // Only explicit missing capability is compatibility fallback, never outages/auth failures.
      if (operation !== 'read' && error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) {
        return operation === 'query' ? { ...EMPTY_RECORDING_WORKFLOW } : { supported: false }
      }
      throw error
    }
  }
}
