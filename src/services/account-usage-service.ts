import type { ArkmeAccountRecordingUsage, ArkmeAccountStorageUsage, ArkmeAccountTokenUsage, ArkmeAccountVoiceUsage, ArkmeRecordingKind, ArkmeRecordingUsageBreakdown, ArkmeStorageCategory, ArkmeStorageBreakdown } from '../account-usage.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
  }
  return value
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value)
}

export function parseTokenUsage(raw: Record<string, unknown>, accountScope: string): ArkmeAccountTokenUsage {
  const used = integer(raw.used_token)
  const remaining = integer(raw.able_token)
  integer(used + remaining)
  return { accountScope, used, remaining }
}

export function parseVoiceUsage(raw: Record<string, unknown>, accountScope: string): ArkmeAccountVoiceUsage {
  const usedSeconds = integer(raw.used_sec)
  const remainingSeconds = integer(raw.able_sec)
  integer(usedSeconds + remainingSeconds)
  return { accountScope, usedSeconds, remainingSeconds }
}

function recordingBreakdown(value: unknown): ArkmeRecordingUsageBreakdown[] {
  if (!Array.isArray(value) || value.length !== 3) throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
  const rows = value.map(raw => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
    const source = raw as Record<string, unknown>
    const recordingKind = integer(source.recording_kind)
    if (![1, 2, 3].includes(recordingKind)) throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
    return {
      recordingKind: recordingKind as ArkmeRecordingKind,
      recordingDurationMillis: source.recording_duration_ms === undefined ? null : nullableInteger(source.recording_duration_ms),
      speechDurationMillis: integer(source.speech_duration_ms),
      requestedSeconds: integer(source.requested_seconds),
      deductedSeconds: integer(source.deducted_seconds),
      waivedSeconds: integer(source.waived_seconds),
    }
  })
  rows.sort((left, right) => left.recordingKind - right.recordingKind)
  if (rows.some((row, index) => row.recordingKind !== index + 1
    || row.requestedSeconds !== row.deductedSeconds + row.waivedSeconds)) {
    throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
  }
  return rows
}

export function parseRecordingUsage(
  raw: Record<string, unknown>,
  pending: Record<string, unknown>,
  accountScope: string,
): ArkmeAccountRecordingUsage {
  const month = typeof raw.month === 'string' ? raw.month : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
  }
  const totalSeconds = nullableInteger(raw.total_seconds)
  const usedSeconds = integer(raw.used_seconds)
  const remainingSeconds = nullableInteger(raw.remaining_seconds)
  const breakdown = recordingBreakdown(raw.breakdown)
  const deductedSeconds = breakdown.reduce((sum, row) => integer(sum + row.deductedSeconds), 0)
  if ((totalSeconds === null) !== (remainingSeconds === null)
    || (totalSeconds !== null && remainingSeconds !== Math.max(totalSeconds - usedSeconds, 0))
    || deductedSeconds !== usedSeconds) {
    throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
  }
  return {
    accountScope,
    month,
    totalSeconds,
    usedSeconds,
    remainingSeconds,
    breakdown,
    statisticsStartedAtMicros: integer(raw.statistics_started_at),
    pendingChildCount: integer(pending.pending_child_count),
  }
}

export function parseStorageUsage(member: Record<string, unknown>, usage: Record<string, unknown>, accountScope: string): ArkmeAccountStorageUsage {
  // Match Flutter's current/legacy field precedence and binary MB conversion.
  const totalBytes = member.file_size !== undefined
    ? integer(member.file_size) : integer(integer(member.file_size_mb) * 1024 * 1024)
  const usedBytes = integer(usage.used_file_size !== undefined ? usage.used_file_size : usage.size)
  const result: ArkmeAccountStorageUsage = { accountScope, usedBytes, totalBytes }
  // Same six categories and reconciliation rule as the mobile App Web page.
  // Keep a valid total even if an older server omits the detailed breakdown.
  if (Array.isArray(usage.breakdown)) {
    try {
      const categories: Record<number, ArkmeStorageCategory> = { 1: 'image', 3: 'video', 5: 'backgroundVoice', 6: 'file', 7: 'callRecording' }
      const grouped = new Map<ArkmeStorageCategory, ArkmeStorageBreakdown>()
      for (const raw of usage.breakdown) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid breakdown')
        const row = raw as Record<string, unknown>
        const category = categories[integer(row.file_type ?? row.fileType)] ?? 'other'
        const current = grouped.get(category) ?? { category, bytes: 0, fileCount: 0 }
        current.bytes = integer(current.bytes + integer(row.file_size ?? row.fileSize))
        current.fileCount = integer(current.fileCount + integer(row.file_count ?? row.fileCount))
        grouped.set(category, current)
      }
      const sum = [...grouped.values()].reduce((sum, item) => integer(sum + item.bytes), 0)
      if (sum === usedBytes) {
        const order: ArkmeStorageCategory[] = ['image', 'video', 'file', 'backgroundVoice', 'callRecording', 'other']
        result.breakdown = order.flatMap(category => {
          const item = grouped.get(category)
          return item && (item.bytes > 0 || item.fileCount > 0) ? [item] : []
        })
      }
    } catch { /* Malformed detail must not invalidate the independently verified total. */ }
  }
  return result
}

/** Independent reads: a storage failure never discards a valid Token result. */
export class AccountUsageService {
  constructor(private readonly runtime: ServiceRuntime) {}

  private async session(expectedScope: string) {
    const session = await this.runtime.requireSession()
    if (expectedScope !== `${this.runtime.config.environment}:${session.userId}`) {
      throw new ArkmePluginError('account-usage-account-changed', '账号已切换，请重新打开用量卡片', false, 409)
    }
    return session
  }

  async tokens(expectedScope: string): Promise<ArkmeAccountTokenUsage> {
    const session = await this.session(expectedScope)
    const raw = await this.runtime.authenticatedAuthReadPost<Record<string, unknown>>('/api/v1/premium/get/q-token-limited-opt', {}, session)
    await this.session(expectedScope)
    return parseTokenUsage(raw, expectedScope)
  }

  async voice(expectedScope: string): Promise<ArkmeAccountVoiceUsage> {
    const session = await this.session(expectedScope)
    const raw = await this.runtime.authenticatedAuthReadPost<Record<string, unknown>>('/api/v1/premium/get/vop-limited-opt', {}, session)
    await this.session(expectedScope)
    return parseVoiceUsage(raw, expectedScope)
  }

  async recording(expectedScope: string, month?: string, signal?: AbortSignal): Promise<ArkmeAccountRecordingUsage> {
    const session = await this.session(expectedScope)
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new ArkmePluginError('account-usage-month-invalid', '录音转写用量月份无效', false, 400)
    }
    const [usage, pending] = await Promise.all([
      this.runtime.authenticatedAuthReadPost<Record<string, unknown>>(
        '/api/v1/premium/get/recording-transcription-usage', month === undefined ? {} : { month }, session, signal,
      ),
      this.runtime.authenticatedAudioPost<Record<string, unknown>>(
        '/api/v1/audio/recording-billing/pending', {}, session, signal,
      ),
    ])
    await this.session(expectedScope)
    return parseRecordingUsage(usage, pending, expectedScope)
  }

  async storage(expectedScope: string): Promise<ArkmeAccountStorageUsage> {
    const session = await this.session(expectedScope)
    const [member, usage] = await Promise.all([
      this.runtime.authenticatedAuthReadPost<Record<string, unknown>>('/api/v1/premium/get/member', {}, session),
      this.runtime.authenticatedAuthReadPost<Record<string, unknown>>('/api/v1/premium/get/used-size', {}, session),
    ])
    await this.session(expectedScope)
    return parseStorageUsage(member, usage, expectedScope)
  }
}
