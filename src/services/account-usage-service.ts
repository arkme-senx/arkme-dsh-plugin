import type { ArkmeAccountStorageUsage, ArkmeAccountTokenUsage, ArkmeAccountVoiceUsage, ArkmeStorageCategory, ArkmeStorageBreakdown } from '../account-usage.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ArkmePluginError('account-usage-contract-invalid', '用量数据暂时无法确认，请重试', true, 502)
  }
  return value
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
