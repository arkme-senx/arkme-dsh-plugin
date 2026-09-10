import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeTimelineCursor } from '../types.js'
import { ArkmePluginError, type ServiceRuntime, objectValue, stringValue } from './service.js'

export interface TopicRecordPage {
  records: unknown[]
  privacyState: 1 | 2
  hasMore: boolean
  nextCursor?: ArkmeTimelineCursor
}

/** Transport contract shared by timeline reading and complete pre-dissolution enumeration.
 * Privacy visibility and mutation policy remain in their respective business owners.
 */
export async function readTopicRecordPage(
  runtime: ServiceRuntime,
  session: ArkmeSessionCredentials,
  topicUid: string,
  options: { limit: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal },
): Promise<TopicRecordPage> {
  const data = await runtime.authenticatedPost<Record<string, unknown>>(
    '/api/v1/topics/display/records/page',
    {
      topic_uid: topicUid,
      limit: options.limit,
      ...(options.cursor === undefined ? {} : {
        cursor_send_at: options.cursor.sendAtMillis,
        cursor_record_uid: options.cursor.itemUid,
      }),
    },
    session,
    options.signal,
  )
  const sendAt = data.next_cursor_send_at
  const uid = stringValue(data.next_cursor_record_uid).trim()
  const hasCursor = typeof sendAt === 'number' && Number.isSafeInteger(sendAt) && sendAt > 0 && uid !== ''
  if (data.topic_uid !== topicUid || !Array.isArray(data.records)
    || typeof data.has_more !== 'boolean' || (data.privacy_state !== 1 && data.privacy_state !== 2)
    || (data.has_more && !hasCursor)
    || data.records.some(raw => stringValue(objectValue(raw).record_uid).trim() === '')) {
    throw new ArkmePluginError('topic-record-page-invalid', '主题快记返回不完整，请重试或确认服务端已升级', true, 502)
  }
  if (data.has_more && options.cursor !== undefined && sendAt === options.cursor.sendAtMillis && uid === options.cursor.itemUid) {
    throw new ArkmePluginError('topic-record-page-invalid', '主题快记分页未推进，请重试', true, 502)
  }
  return {
    records: data.records,
    privacyState: data.privacy_state,
    hasMore: data.has_more,
    ...(hasCursor ? { nextCursor: { sendAtMillis: sendAt, itemUid: uid } } : {}),
  }
}
