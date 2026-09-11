import type { ArkmeSourceItem } from './types.js'

// Topic container kind is independent of source directory kind and record provenance.
export const ARKME_DSH_INPUT_TOPIC_KIND = 3
export const ARKME_DSH_INPUT_TOPIC_TITLE = '发给 DSH 的消息'
export const ARKME_DSH_INPUT_TOPIC_DESCRIPTION = '自动归档 DSH 会话中的输入消息，不支持在此新增快记'

/** Display only; source identities and stored titles remain unchanged. */
export function arkmeTopicDisplayName(title: string, topicKind: number | undefined): string {
  return topicKind === ARKME_DSH_INPUT_TOPIC_KIND ? ARKME_DSH_INPUT_TOPIC_TITLE : title
}

export function isArkmeDSHInputTopic(source: Pick<ArkmeSourceItem, 'kind' | 'topicKind'> | undefined): boolean {
  return source?.kind === 'topic' && source.topicKind === ARKME_DSH_INPUT_TOPIC_KIND
}

export function arkmeSourceAllowsUserWrite(source: Pick<ArkmeSourceItem, 'kind' | 'topicKind'>): boolean {
  return !isArkmeDSHInputTopic(source)
}
