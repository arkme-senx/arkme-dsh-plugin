import type { ArkmeRecordTopicAssignmentInput, ArkmeRecordTopicAssignmentResult } from '../record-topic-assignment-contract.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { callArkme } from './api.js'
import { createSelfTopic } from './create-self-topic.js'
import { arkmeAuthStore } from './auth-store.js'
import { selfTopicDirectory } from './self-topic-directory-cache.js'

export type RecordTopicAssignmentTarget = ArkmeSourceItem & { topicHierarchyKey: string }

export interface RecordTopicAssignmentPort {
  listTopics(keyword: string, cursor: string | undefined, signal: AbortSignal): Promise<{ items: RecordTopicAssignmentTarget[]; hasMore: boolean; nextCursor?: string }>
  createTopic(title: string, contextSourceRef: string, signal: AbortSignal): Promise<ArkmeSourceItem>
  assign(input: ArkmeRecordTopicAssignmentInput, signal: AbortSignal): Promise<ArkmeRecordTopicAssignmentResult>
}

// Keep transport deadlines below the business UI; expiration is an unknown write outcome.
async function request<T>(operation: Parameters<typeof callArkme>[0], params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const deadline = AbortSignal.timeout(60_000)
  try { return await callArkme<T>(operation, params, AbortSignal.any([signal, deadline])) }
  catch (error) {
    if (deadline.aborted && !signal.aborted) throw new Error('请求超时，请刷新核对后再操作')
    throw error
  }
}

export const recordTopicAssignmentPort: RecordTopicAssignmentPort = {
  async listTopics(keyword, cursor, signal) {
    const page = await request<ArkmeSourceList>('topic.candidates', {
      keyword,
      ...(cursor === undefined ? {} : { cursor }),
    }, signal)
    const items = page.items.filter(item => item.kind === 'topic').map(item => {
      if (!item.topicHierarchyKey?.trim()) throw new Error('主题身份信息不完整，请重试')
      return { ...item, topicHierarchyKey: item.topicHierarchyKey }
    })
    return { items, hasMore: page.hasMore, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
  },
  async createTopic(title, contextSourceRef, signal) {
    const auth = arkmeAuthStore.getSnapshot().auth
    if (auth?.status !== 'authenticated' || auth.userId === undefined) throw new Error('请先登录')
    const result = await createSelfTopic({ title, contextSourceRef }, selfTopicDirectory(auth.userId, auth.environment), signal)
    if (result.warning !== undefined) throw new Error(result.warning)
    return result.source
  },
  async assign(input, signal) {
    return await request<ArkmeRecordTopicAssignmentResult>('source.record-topic.assign', { ...input }, signal)
  },
}
