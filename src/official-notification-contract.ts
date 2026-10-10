export interface ArkmeOfficialNotification {
  id: string
  title: string
  summary: string
  bodyMarkdown?: string
  publishedAtMillis: number
  readAtMillis: number
}
export interface ArkmeOfficialNotificationPage {
  items: ArkmeOfficialNotification[]
  nextCursor: string
}
export interface ArkmeOfficialNotificationSummary {
  total: number
  unreadCount: number
  latest?: ArkmeOfficialNotification
}
export interface ArkmeOfficialNotificationRead {
  accountKey: string
  ids?: readonly string[]
  all?: boolean
}
export interface ArkmeOfficialNotificationPort {
  listOfficialNotifications(
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotificationPage>
  officialNotificationSummary(
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotificationSummary>
  officialNotificationDetail(
    id: string,
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotification>
  readOfficialNotifications(
    input: ArkmeOfficialNotificationRead,
    signal?: AbortSignal,
  ): Promise<ArkmeOfficialNotificationSummary>
}
