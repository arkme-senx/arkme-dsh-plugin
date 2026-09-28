import { describe, expect, it } from 'vitest'
import { projectOwnedRecordExtensions } from '../src/record-extension-tree.js'

describe('owned record extension tree', () => {
  it('shows only descendants of the opened note, including nested replies outside its topic', () => {
    const nodes = projectOwnedRecordExtensions({
      record_uid: 'child-a', root_record_uid: 'root',
      tree: { record_uid: 'root', children: [
        { record_uid: 'child-a', children: [{ record_uid: 'reply-b', children: [{ record_uid: 'reply-c', children: [] }] }] },
        { record_uid: 'sibling', children: [] },
      ] },
      edges: [
        { parent_record_uid: 'child-a', child_record_uid: 'reply-b', status: 1, create_at: 100 },
        { parent_record_uid: 'reply-b', child_record_uid: 'reply-c', status: 1, create_at: 200 },
      ],
      records: [
        { record_uid: 'reply-b', content_access_state: 1, status: 1 },
        { record_uid: 'reply-c', content_access_state: 2, status: 1 },
        { record_uid: 'sibling', content_access_state: 1, status: 1 },
      ],
    }, 'child-a')
    expect(nodes.map(node => [node.recordUid, node.parentRecordUid, node.level, node.protectedContent]))
      .toEqual([['reply-b', 'child-a', 2, false], ['reply-c', 'reply-b', 3, true]])
    expect(nodes[0]?.createdAtMillis).toBe(100)
  })

  it('falls back to active edges if the server omits a nested tree', () => {
    const nodes = projectOwnedRecordExtensions({
      record_uid: 'root', root_record_uid: 'root',
      edges: [
        { parent_record_uid: 'root', child_record_uid: 'shown', status: 1 },
        { parent_record_uid: 'root', child_record_uid: 'deleted', status: 2 },
      ],
      records: [
        { record_uid: 'shown', content_access_state: 1 },
        { record_uid: 'deleted', content_access_state: 1 },
      ],
    }, 'root')
    expect(nodes.map(node => node.recordUid)).toEqual(['shown'])
  })

  it('does not accept a tree for a different opened record', () => {
    expect(() => projectOwnedRecordExtensions({ record_uid: 'other', root_record_uid: 'other' }, 'mine'))
      .toThrow('记录延展树与当前快记不匹配')
  })
})
