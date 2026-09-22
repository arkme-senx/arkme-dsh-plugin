import type { ArkmeSourceItem, ArkmeTopicCreateResult, ArkmeTopicHierarchyMoveResult } from '../types.js'
import { arkmeSourceAllowsUserWrite } from '../topic-policy.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import type { SelfTopicDirectoryCache } from './self-topic-directory-cache.js'
import { sortArkmeSourceTree } from './source-tree.js'

/** Reuse the account directory; creation never waits for its post-write reconciliation. */
export async function createSelfTopic(
  params: { title: string; parentSourceRef?: string; contextSourceRef?: string },
  directory: SelfTopicDirectoryCache,
  signal?: AbortSignal,
): Promise<ArkmeTopicCreateResult & { sources?: ArkmeSourceItem[] }> {
  signal = AbortSignal.any([directory.signal, AbortSignal.timeout(60_000), ...(signal ? [signal] : [])])
  const cached = directory.getSnapshot()
  if (!cached.complete || cached.error) {
    await withArkmeReadDeadline(() => directory.ensure(!!cached.error), signal)
  }
  const snapshot = directory.getSnapshot()
  if (!snapshot.complete || snapshot.error) throw new Error(snapshot.error || '主题加载未完成，请刷新后重试')
  const parent = snapshot.sources.find(source => source.sourceRef === params.parentSourceRef)
  if (params.parentSourceRef !== undefined && parent === undefined) throw new Error('父主题已变化')
  const parentKey = parent?.topicHierarchyKey ?? parent?.sourceRef
  const peers = (sources: readonly ArkmeSourceItem[], created?: ArkmeSourceItem) => sortArkmeSourceTree(
    sources.filter(source => source.kind === 'topic' && arkmeSourceAllowsUserWrite(source)
      && (source.topicHierarchyKey ?? source.sourceRef) !== (created?.topicHierarchyKey ?? created?.sourceRef)
      && (source.parentTopicHierarchyKey ?? source.parentSourceRef) === parentKey)
      .map(source => ({ source, children: [] })), 'custom',
  ).map(node => node.source)
  const first = peers(snapshot.sources)[0]
  signal.throwIfAborted()
  const result = await callArkme<ArkmeTopicCreateResult>('topic.create', params, signal)
  const checkCreationScope = () => {
    if (signal.aborted) throw new Error('主题已创建，但操作已取消，请在原账号核对，不要重复创建。')
  }
  checkCreationScope()
  if (result.warning !== undefined) {
    directory.upsert(result.source)
    return result
  }
  try {
    signal.throwIfAborted()
    const moved = await callArkme<ArkmeTopicHierarchyMoveResult>('topic.hierarchy.move', {
      sourceRef: result.source.sourceRef,
      ...(params.parentSourceRef === undefined ? {} : {
        currentParentSourceRef: params.parentSourceRef, nextParentSourceRef: params.parentSourceRef,
      }),
      ...(first === undefined ? {} : { insertBeforeSourceRef: first.sourceRef }),
    }, signal)
    signal.throwIfAborted()
    const source = { ...result.source, siblingOrder: moved.siblingOrder }
    // Temporary display ranks preserve the sibling order until the shared read
    // replaces them with the server's renumbered ranks. They are not write inputs.
    const related = peers(directory.getSnapshot().sources, source)
      .map((peer, index) => ({ ...peer, siblingOrder: moved.siblingOrder + index + 1 }))
    directory.upsert(source, related)
    void directory.refreshAfterMutation()
    return { source, sources: directory.getSnapshot().sources }
  } catch {
    checkCreationScope()
    directory.upsert(result.source)
    void directory.refreshAfterMutation()
    return { ...result, warning: '主题已创建，但首位排序尚未确认，请刷新核对；如未排在首位，可拖动调整。' }
  }
}
