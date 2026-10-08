import type {
  ArkmeOfficialNotification,
  ArkmeOfficialNotificationPage,
  ArkmeOfficialNotificationRead,
  ArkmeOfficialNotificationSummary,
} from '../official-notification-contract.js'
import { ArkmePluginError, ServiceRuntime, objectValue } from './service.js'

const invalid = () =>
  new ArkmePluginError(
    'official-notification-invalid',
    '官方通知数据无效，请重试',
    false,
    502,
  )
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalid()
  return value
}
export function officialNotification(raw: unknown): ArkmeOfficialNotification {
  const item = objectValue(raw)
  if (
    typeof item.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(item.id) ||
    typeof item.title !== 'string' ||
    typeof item.summary !== 'string' ||
    item.status !== 'published'
  )
    throw invalid()
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    publishedAtMillis: integer(item.published_at),
    readAtMillis: integer(item.read_at),
    ...(typeof item.body_markdown === 'string'
      ? { bodyMarkdown: item.body_markdown }
      : {}),
  }
}
export function officialSummary(
  raw: unknown,
): ArkmeOfficialNotificationSummary {
  const value = objectValue(raw),
    total = integer(value.total),
    unreadCount = integer(value.unread_count)
  if (unreadCount > total) throw invalid()
  return {
    total,
    unreadCount,
    ...(value.latest == null
      ? {}
      : { latest: officialNotification(value.latest) }),
  }
}
export class OfficialNotificationService {
  constructor(private readonly runtime: ServiceRuntime) {}
  private async request(
    operation: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    accountKey?: string,
  ): Promise<unknown> {
    const session = await this.runtime.requireSession()
    if (
      accountKey !== undefined &&
      accountKey !== `${this.runtime.config.environment}:${session.userId}`
    )
      throw new ArkmePluginError(
        'official-notification-account-changed',
        '账号已变化，请重试',
        false,
        409,
      )
    const data = await this.runtime.authenticatedPost<unknown>(
      `/api/v1/official-notifications/${operation}`,
      body,
      session,
      signal,
      {
        lane:
          operation === 'read' || operation === 'read-all'
            ? 'write'
            : 'interactive-read',
      },
    )
    const current = await this.runtime.accountScopedSession()
    if (
      signal?.aborted ||
      current?.userId !== session.userId ||
      current.refreshToken !== session.refreshToken
    )
      throw new ArkmePluginError(
        'official-notification-account-changed',
        '账号已变化，请重试',
        false,
        409,
      )
    return data
  }
  async list(
    cursor = '',
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotificationPage> {
    return this.runtime.runOwnerRead(
      'official-notifications',
      { cursor },
      async (readSignal) => {
        const value = objectValue(
          await this.request('query', { cursor, limit: 50 }, readSignal),
        )
        if (
          !Array.isArray(value.items) ||
          typeof value.next_cursor !== 'string' ||
          (cursor !== '' && cursor === value.next_cursor)
        )
          throw invalid()
        return {
          items: value.items.map(officialNotification),
          nextCursor: value.next_cursor,
        }
      },
      signal,
    )
  }
  async summary(
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotificationSummary> {
    return officialSummary(await this.request('summary', {}, signal))
  }
  async detail(
    id: string,
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotification> {
    return officialNotification(await this.request('detail', { id }, signal))
  }
  async read(
    input: ArkmeOfficialNotificationRead,
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotificationSummary> {
    if (
      typeof input.accountKey !== 'string' ||
      input.accountKey === '' ||
      (input.all === true
        ? input.ids !== undefined
        : !Array.isArray(input.ids) ||
          input.ids.length < 1 ||
          input.ids.length > 100)
    )
      throw invalid()
    try {
      return officialSummary(
        await this.request(
          input.all === true ? 'read-all' : 'read',
          input.all === true ? {} : { ids: input.ids },
          signal,
          input.accountKey,
        ),
      )
    } finally {
      const session = await this.runtime.accountScopedSession()
      if (session)
        this.runtime.invalidateKey(
          this.runtime.requestScope(session.userId),
          'owner-read:official-notifications:',
        )
    }
  }
}
