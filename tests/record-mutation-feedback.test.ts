import { describe, expect, it } from 'vitest'
import { RecordMutationFeedback, topicMutationBelongs } from '../src/client/record-mutation-feedback.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'
const self = { kind: 'send_to_self', sourceRef: 'self' } as ArkmeSourceItem
const old = { kind: 'topic', sourceRef: 'old', topicHierarchyKey: 'old-key', displayName: '工作' } as ArkmeSourceItem
const target = { kind: 'topic', sourceRef: 'target', topicHierarchyKey: 'target-key', parentTopicHierarchyKey: 'old-key', displayName: '产品' } as ArkmeSourceItem
const other = { ...target, sourceRef: 'other', topicHierarchyKey: 'other-key', parentTopicHierarchyKey: undefined } as ArkmeSourceItem
const item = (id = 'a') => ({ itemUid: id, status: 1, recordVersion: 2, recordDeletionRef: 'delete', recordTopicAssignmentRef: 'old-ref',
  selfTopic: { topicHierarchyKey: 'old-key', sourceRef: 'old', title: '工作' }, recordTopicAssignmentTopicKey: 'old-key', textContent: '原内容' }) as ArkmeTimelineItem
const directory = [self, old, target, other]
describe('optimistic personal record operations', () => {
  it('updates membership before a receipt, keeps content, and disables stale signed actions', () => {
    const owner = new RecordMutationFeedback(), original = item()
    owner.begin('topic', self, [original], target, directory)
    expect(owner.project(original, self, directory)).toMatchObject({ textContent: '原内容', selfTopic: { topicHierarchyKey: 'target-key' } })
    expect(owner.project(original, self, directory)?.recordTopicAssignmentRef).toBeUndefined()
    expect(original.selfTopic?.topicHierarchyKey).toBe('old-key')
    expect(owner.getSnapshot().receipts[0]).toMatchObject({ phase: 'pending', label: '工作 / 产品' })
  })
  it('keeps a descendant move in the parent view, removes it from an unrelated topic, shows it in destination before projection', () => {
    const owner = new RecordMutationFeedback(), original = item()
    owner.begin('topic', old, [original], target, directory)
    expect(owner.project(original, old, directory)).toBeDefined()
    expect(owner.project(original, other, directory)).toBeUndefined()
    expect(owner.projectWindow([], target, directory)).toHaveLength(1)
    expect(topicMutationBelongs({ kind: 'default_category' } as ArkmeSourceItem, target, directory)).toBe(false)
    expect(topicMutationBelongs({ kind: 'default_category' } as ArkmeSourceItem, undefined, directory)).toBe(true)
  })
  it('does not use topic names as identity and safely terminates cyclic hierarchy', () => {
    expect(topicMutationBelongs(old, { ...other, displayName: '工作' }, directory)).toBe(false)
    expect(topicMutationBelongs(other, { ...target, parentTopicHierarchyKey: target.topicHierarchyKey }, [target])).toBe(false)
  })
  it('keeps confirmed membership across stale reads and releases only after a matching fresh signed read', () => {
    const owner = new RecordMutationFeedback(), original = item(), before = owner.readEpoch
    const id = owner.begin('topic', self, [original], target)
    owner.settleTopic(id, { movedRecordUids: ['a'], projectionRefreshPending: true })
    owner.observe([original], self, owner.readEpoch)
    expect(owner.project(original, self, directory)?.selfTopic?.topicHierarchyKey).toBe('target-key')
    const fresh = { ...original, selfTopic: { topicHierarchyKey: 'target-key' }, recordTopicAssignmentRef: 'new-ref' }
    owner.observe([fresh], self, before)
    expect(owner.project(original, self, directory)?.recordTopicAssignmentRef).toBeUndefined()
    const epoch = owner.readEpoch
    owner.observe([fresh], self, epoch)
    expect(owner.project(fresh, self, directory)?.recordTopicAssignmentRef).toBe('new-ref')
    expect(owner.readEpoch).toBeGreaterThan(epoch)
    const second = owner.begin('topic', self, [fresh], other)
    expect(second).toBeGreaterThan(id)
  })
  it('immediately removes deletions; partial failure restores only the failed and unknown rows at original timestamps', () => {
    const owner = new RecordMutationFeedback(), originals = [item('a'), item('b'), item('c')]
    const id = owner.begin('delete', self, originals)
    expect(owner.projectWindow(originals, self, directory)).toEqual([])
    owner.settleDeletion(id, { items: [{ recordUid: 'a', version: 3, result: 'deleted' },
      { recordUid: 'b', version: 2, result: 'rejected', message: '冲突' }, { recordUid: 'c', version: 2, result: 'unknown' }] })
    expect(owner.projectWindow([], self, directory).map(item => item.itemUid)).toEqual(['b', 'c'])
    expect(owner.project(item('a'), self, directory)).toBeUndefined()
    expect(owner.project(item('b'), self, directory)?.recordDeletionRef).toBe('delete')
    expect(owner.project(item('c'), self, directory)?.recordDeletionRef).toBeUndefined()
    expect(owner.project({ ...item('a'), recordVersion: 4 }, self, directory)).toBeDefined()
  })
  it('restores an uncertain move without lying about success or allowing duplicate submission', () => {
    const owner = new RecordMutationFeedback(), original = item()
    const id = owner.begin('topic', old, [original], other)
    owner.fail(id, new Error('timeout'))
    expect(owner.projectWindow([], old, directory)[0]?.selfTopic?.topicHierarchyKey).toBe('old-key')
    expect(owner.getSnapshot().receipts[0]?.phase).toBe('uncertain')
    expect(() => owner.begin('topic', old, [original], other)).toThrow()
    owner.observe([original], old, owner.readEpoch)
    expect(owner.getSnapshot().receipts[0]?.phase).toBe('uncertain')
  })
  it('does not interpret absence from a page as a successful deletion', () => {
    const owner = new RecordMutationFeedback(), id = owner.begin('delete', self, [item()])
    owner.fail(id, new Error('timeout')); owner.observe([], self, owner.readEpoch)
    expect(owner.getSnapshot().receipts[0]?.phase).toBe('uncertain')
    owner.observe([{ ...item(), status: 2, recordVersion: 3 }], self, owner.readEpoch)
    expect(owner.getSnapshot().receipts[0]?.phase).toBe('confirmed')
    expect(owner.project(item(), self, directory)).toBeUndefined()
  })
  it('does not alter chat occurrences and isolates accounts', () => {
    const owner = new RecordMutationFeedback(), original = item()
    owner.begin('delete', self, [original])
    expect(owner.project(original, { kind: 'group_chat' } as ArkmeSourceItem, directory)).toBe(original)
    expect(new RecordMutationFeedback().project(original, self, directory)).toBe(original)
  })
})
