import { beforeEach, expect, it, vi } from 'vitest'
import { RecordMutationFeedback } from '../src/client/record-mutation-feedback.js'
import { submitRecordMutation } from '../src/client/record-mutation-submit.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ delete: vi.fn(), assign: vi.fn(), invalidate: vi.fn(), changed: vi.fn(),
  auth: { userId: 42, environment: 'prod', status: 'authenticated' }, listener: undefined as (() => void) | undefined }))
vi.mock('../src/client/record-deletion-port.js', () => ({ recordDeletionClientPort: { delete: mocks.delete } }))
vi.mock('../src/client/record-topic-assignment-port.js', () => ({ recordTopicAssignmentPort: { assign: mocks.assign } }))
vi.mock('../src/client/self-topic-directory-cache.js', () => ({ selfTopicDirectory: () => ({ invalidate: mocks.invalidate }) }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { recordChanged: mocks.changed, chatChanged: mocks.changed } }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { getSnapshot: () => ({ auth: mocks.auth }),
  subscribe: (listener: () => void) => { mocks.listener = listener; return () => { mocks.listener = undefined } } } }))
const source = { kind: 'send_to_self', sourceRef: 'self' } as ArkmeSourceItem
const target = { kind: 'topic', sourceRef: 'target', topicHierarchyKey: 'target', displayName: '产品' } as ArkmeSourceItem
const items = [{ itemUid: 'a', status: 1, recordVersion: 1, recordDeletionRef: 'delete-ref', recordTopicAssignmentRef: 'assign-ref' }] as ArkmeTimelineItem[]
beforeEach(() => { vi.clearAllMocks(); mocks.auth = { userId: 42, environment: 'prod', status: 'authenticated' } })
it('keeps optimistic deletion while the backend is slow; a receipt commits it independently of subscribers', async () => {
  let resolve!: (result: unknown) => void
  mocks.delete.mockImplementation(() => new Promise(done => { resolve = done }))
  const owner = new RecordMutationFeedback(), id = owner.begin('delete', source, items)
  const unsubscribe = owner.subscribe(() => {}), running = submitRecordMutation(owner, id, 'delete', source, items)
  expect(owner.projectWindow(items, source, [])).toEqual([])
  unsubscribe() // closing a menu or navigating away cannot abort this owner
  resolve({ items: [{ recordUid: 'a', result: 'deleted', version: 2 }] }); await running
  expect(owner.getSnapshot().receipts[0]?.phase).toBe('confirmed')
  expect(mocks.delete).toHaveBeenCalledExactlyOnceWith('self', ['delete-ref'], expect.any(AbortSignal))
})
it('submits exact frozen assignment refs once; lost responses roll back presentation without replay', async () => {
  mocks.assign.mockRejectedValue(new Error('offline'))
  const owner = new RecordMutationFeedback(), id = owner.begin('topic', source, items, target)
  await submitRecordMutation(owner, id, 'topic', source, items, target)
  expect(mocks.assign).toHaveBeenCalledExactlyOnceWith({ sourceRef: 'self', assignmentRefs: ['assign-ref'], targetSourceRef: 'target' }, expect.any(AbortSignal))
  expect(owner.getSnapshot().receipts[0]?.phase).toBe('uncertain')
  expect(mocks.invalidate).toHaveBeenCalledOnce()
  expect(owner.projectWindow(items, source, [target])[0]?.selfTopic).toBeUndefined()
})
it('aborts a running write on account change without exposing its result to the next account', async () => {
  mocks.delete.mockImplementation((_source, _refs, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
  const owner = new RecordMutationFeedback(), id = owner.begin('delete', source, items)
  const running = submitRecordMutation(owner, id, 'delete', source, items)
  mocks.auth = { ...mocks.auth, userId: 99 }; mocks.listener?.(); await running
  expect(owner.getSnapshot().receipts[0]?.phase).toBe('uncertain')
  expect(new RecordMutationFeedback().projectWindow(items, source, [])).toEqual(items)
})
it('treats only known pre-write validation failures as definite failures', async () => {
  mocks.assign.mockRejectedValue({ body: { code: 'record-topic-reference-invalid' } })
  const owner = new RecordMutationFeedback(), id = owner.begin('topic', source, items, target)
  await submitRecordMutation(owner, id, 'topic', source, items, target)
  expect(owner.getSnapshot().receipts[0]?.phase).toBe('failed')
})
