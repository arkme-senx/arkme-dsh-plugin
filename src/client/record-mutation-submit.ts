import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { recordDeletionClientPort } from './record-deletion-port.js'
import { recordTopicAssignmentPort } from './record-topic-assignment-port.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { selfTopicDirectory } from './self-topic-directory-cache.js'
import type { RecordMutationFeedback } from './record-mutation-feedback.js'

/** Own submitted requests outside transient menus; navigation must not cancel a write. */
export async function submitRecordMutation(owner: RecordMutationFeedback, id: number, kind: 'delete' | 'topic',
  source: ArkmeSourceItem, items: readonly ArkmeTimelineItem[], target?: ArkmeSourceItem) {
  const account = arkmeAuthStore.getSnapshot().auth
  const controller = new AbortController()
  const unsubscribe = arkmeAuthStore.subscribe(() => {
    const current = arkmeAuthStore.getSnapshot().auth
    if (current?.userId !== account?.userId || current?.environment !== account?.environment || current?.status !== 'authenticated') controller.abort()
  })
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)])
  try {
    if (account?.status !== 'authenticated') throw new Error('请先登录')
    if (kind === 'delete') owner.settleDeletion(id, await recordDeletionClientPort.delete(source.sourceRef, items.map(item => item.recordDeletionRef!), signal))
    else owner.settleTopic(id, await recordTopicAssignmentPort.assign({ sourceRef: source.sourceRef,
      assignmentRefs: items.map(item => item.recordTopicAssignmentRef!), ...(target ? { targetSourceRef: target.sourceRef } : {}),
    }, signal))
  } catch (error) {
    // Only known PRE-WRITE validation errors establish that no write occurred.
    const code = (error as { body?: { code?: string } })?.body?.code ?? ''
    owner.fail(id, error, ['record-topic-selection-invalid', 'record-topic-reference-invalid', 'record-topic-target-invalid',
      'record-topic-release-invalid', 'record-delete-selection-invalid', 'record-delete-reference-invalid', 'account-changed'].includes(code))
  } finally {
    unsubscribe()
    if (account?.userId !== undefined) selfTopicDirectory(account.userId, account.environment).invalidate()
    arkmeUi.recordChanged(); arkmeUi.chatChanged()
  }
}
