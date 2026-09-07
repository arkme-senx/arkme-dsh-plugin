import type { ArkmeSourceItem } from './types.js'

// Topic container kind is independent of source directory kind and record provenance.
export const ARKME_DSH_INPUT_TOPIC_KIND = 3

export function isArkmeDSHInputTopic(source: Pick<ArkmeSourceItem, 'kind' | 'topicKind'> | undefined): boolean {
  return source?.kind === 'topic' && source.topicKind === ARKME_DSH_INPUT_TOPIC_KIND
}

export function arkmeSourceAllowsUserWrite(source: Pick<ArkmeSourceItem, 'kind' | 'topicKind'>): boolean {
  return !isArkmeDSHInputTopic(source)
}
