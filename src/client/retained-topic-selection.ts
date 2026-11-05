import type { ArkmeArchiveState } from '../archive-contract.js'
import type { ArkmeSourceItem } from '../types.js'
import { isArkmeDSHInputTopic } from '../topic-policy.js'
import { callArkme } from './api.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

/** Directory membership does not own the lifetime of an explicitly opened topic. */
export async function retainedTopicSelection(
  selected: ArkmeSourceItem,
  signal: AbortSignal,
): Promise<ArkmeSourceItem | undefined> {
  if (selected.kind !== 'topic') return undefined
  const states = await callArkme<ArkmeArchiveState[]>('archives.state', { sourceRefs: [selected.sourceRef] }, signal)
  signal.throwIfAborted()
  if (states[0]?.ownerAvailable === true && states[0].effectiveArchived) return selected
  // Archive state covers ordinary personal topics only. The hidden system
  // container needs its own metadata-backed identity and permission check.
  const source = await callArkme<ArkmeSourceItem | null>('topic.hidden-source', { sourceRef: selected.sourceRef }, signal)
  signal.throwIfAborted()
  if (source === null) return undefined
  if (!isArkmeDSHInputTopic(source) || arkmeSourceIdentityKey(source) !== arkmeSourceIdentityKey(selected)) {
    throw new Error('隐藏主题身份返回不一致，请刷新重试')
  }
  return source
}
