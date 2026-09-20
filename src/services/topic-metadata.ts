import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, type ServiceRuntime, objectValue, stringValue } from './service.js'

export interface TopicMetadata {
  topicKind: number
  privacyState: 1 | 2
  showInHome: boolean
}

/** Lightweight topic identity/settings contract. It never loads records or summary statistics. */
export async function readTopicMetadata(
  runtime: ServiceRuntime,
  session: ArkmeSessionCredentials,
  topicUid: string,
  signal?: AbortSignal,
): Promise<TopicMetadata> {
  const data = await runtime.authenticatedPost<Record<string, unknown>>(
    '/api/v1/topics/display/metadata',
    { topic_uid: topicUid },
    session,
    signal,
  )
  const core = objectValue(data.topic_core)
  const topicKind = typeof core.kind === 'number' ? core.kind : 0
  if (stringValue(core.topic_uid).trim() !== topicUid
    || !Number.isSafeInteger(topicKind) || topicKind <= 0
    || (core.privacy_state !== 1 && core.privacy_state !== 2)
    || typeof core.show_in_home !== 'boolean') {
    throw new ArkmePluginError('topic-metadata-invalid', '主题信息返回不完整，请重试或确认服务端已升级', true, 502)
  }
  return {
    topicKind,
    privacyState: core.privacy_state,
    showInHome: core.show_in_home,
  }
}
