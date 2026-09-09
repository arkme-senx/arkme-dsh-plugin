import { describe, expect, it, vi } from 'vitest'
import { sealRecordTopicAssignmentRef, openRecordTopicAssignmentRef } from '../src/record-topic-assignment-ref.js'
import { RecordTopicAssignmentService } from '../src/services/record-topic-assignment-service.js'

const key = 'test-signing-key'
const selection = { userId: 42, sourceKind: 'send_to_self' as const, sourceOwnerRef: 'self', recordUid: 'record-a', sourceTopicUid: 'old-a' }
function fixture() {
  const session = { userId: 42 }
  const post = vi.fn(async (_path, body) => ({ moved_count: body.items.length, projection_refresh_pending: true,
    items: body.items.map(item => ({ record_uid: item.record_uid, target_status: body.target_topic_uid ? 1 : undefined,
      target_is_primary: Boolean(body.target_topic_uid), source_status: item.source_topic_uid ? 2 : undefined, idempotent_replay: false })) }))
  const runtime = { requireSession: vi.fn(async () => session), stateStore: { uniqueCode: async () => key }, authenticatedPost: post }
  const source = { openSourceRef: vi.fn(async (ref: string) => ref === 'target'
    ? { userId: 42, kind: 'topic', ownerRef: 'target-topic' }
    : { userId: 42, kind: 'send_to_self', ownerRef: 'self' }), invalidateSourceListCache: vi.fn() }
  const service = new RecordTopicAssignmentService(runtime as never, source as never)
  return { service, post, runtime, source, session }
}
const ref = (overrides = {}) => sealRecordTopicAssignmentRef({ ...selection, ...overrides }, key)

describe('record topic assignment capability', () => {
  it('round trips the observed relation without carrying content or forwarding identity', () => {
    expect(openRecordTopicAssignmentRef(ref(), key)).toEqual(selection)
    expect(ref().length).toBeLessThan(600)
  })
  it('rejects tampering and foreign capability families', () => {
    expect(() => openRecordTopicAssignmentRef(ref().replace('v1.', 'v2.'), key)).toThrow()
    expect(() => openRecordTopicAssignmentRef(ref(), 'other-key')).toThrow()
    expect(() => openRecordTopicAssignmentRef('arkme-message-action-v1.payload.sig', key)).toThrow()
  })
})

describe('record topic assignment owner service', () => {
  it('moves mixed source topics once and preserves Record identities', async () => {
    const { service, post } = fixture()
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref(), ref({ recordUid: 'record-b', sourceTopicUid: '' })], targetSourceRef: 'target' }))
      .resolves.toMatchObject({ movedRecordUids: ['record-a', 'record-b'], projectionRefreshPending: true })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/v1/topics/records/move-batch', {
      target_topic_uid: 'target-topic', items: [{ record_uid: 'record-a', source_topic_uid: 'old-a' }, { record_uid: 'record-b' }],
    }])
  })
  it('uses uncategorized membership from the default category without inventing a source topic', async () => {
    const { service, source, post } = fixture()
    source.openSourceRef.mockImplementation(async value => value === 'target'
      ? { userId: 42, kind: 'topic', ownerRef: 'target-topic' }
      : { userId: 42, kind: 'default_category', ownerRef: 'uncategorized' })
    await service.assign({ sourceRef: 'default', assignmentRefs: [ref({ sourceKind: 'default_category',
      sourceOwnerRef: 'uncategorized', sourceTopicUid: '' })], targetSourceRef: 'target' })
    expect(post.mock.calls[0]?.[1]).toEqual({ target_topic_uid: 'target-topic', items: [{ record_uid: 'record-a' }] })
  })
  it('returns only actual changes when selection also contains a record already in the target', async () => {
    const { service, post } = fixture()
    const result = await service.assign({ sourceRef: 'self', assignmentRefs: [ref(),
      ref({ recordUid: 'unchanged', sourceTopicUid: 'target-topic' })], targetSourceRef: 'target' })
    expect(result.movedRecordUids).toEqual(['record-a'])
    expect(post.mock.calls[0]?.[1].items).toEqual([{ record_uid: 'record-a', source_topic_uid: 'old-a' }])
  })
  it('accepts the full supported batch without splitting it into individual writes', async () => {
    const { service, post } = fixture()
    const result = await service.assign({ sourceRef: 'self', assignmentRefs: Array.from({ length: 100 },
      (_, i) => ref({ recordUid: `r-${i}` })), targetSourceRef: 'target' })
    expect(result.movedRecordUids).toHaveLength(100)
    expect(post).toHaveBeenCalledOnce()
  })
  it('rejects duplicate result identities even when the owner count and response length match', async () => {
    const { service, post } = fixture()
    const item = { record_uid: 'record-a', target_status: 1, target_is_primary: true, source_status: 2 }
    post.mockResolvedValue({ moved_count: 2, projection_refresh_pending: true, items: [item, item] } as never)
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref(), ref({ recordUid: 'record-b' })],
      targetSourceRef: 'target' })).rejects.toMatchObject({ writeOutcomeUnknown: true })
    expect(post).toHaveBeenCalledOnce()
  })
  it('skips records already in the target', async () => {
    const { service, post } = fixture()
    const result = await service.assign({ sourceRef: 'self', assignmentRefs: [ref({ sourceTopicUid: 'target-topic' })], targetSourceRef: 'target' })
    expect(result.movedRecordUids).toEqual([])
    expect(post).not.toHaveBeenCalled()
  })
  it.each([
    ['foreign account', [ref({ userId: 99 })]],
    ['foreign source', [ref({ sourceOwnerRef: 'other' })]],
    ['foreign source kind', [ref({ sourceKind: 'topic' })]],
    ['duplicate records', [ref(), ref({ sourceTopicUid: 'other' })]],
    ['empty selection', []],
    ['over limit', Array.from({ length: 101 }, (_, i) => ref({ recordUid: `r-${i}` }))],
  ])('rejects %s before owner writes', async (_label, refs) => {
    const { service, post } = fixture()
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: refs as string[], targetSourceRef: 'target' })).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
  it('allows release only from the selected personal topic scope', async () => {
    const { service, source, post } = fixture()
    source.openSourceRef.mockResolvedValue({ userId: 42, kind: 'topic', ownerRef: 'old-a' })
    await service.assign({ sourceRef: 'old', assignmentRefs: [ref({ sourceKind: 'topic', sourceOwnerRef: 'old-a' })] })
    expect(post.mock.calls[0]?.[1]).toEqual({ items: [{ record_uid: 'record-a', source_topic_uid: 'old-a' }] })
  })
  it('rejects release from aggregate and chat targets', async () => {
    const { service, source, post } = fixture()
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref()] })).rejects.toThrow()
    source.openSourceRef.mockImplementation(async (r) => r === 'target' ? { userId: 42, kind: 'group_chat', ownerRef: 'chat' } : { userId: 42, kind: 'send_to_self', ownerRef: 'self' })
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref()], targetSourceRef: 'target' })).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
  it.each([
    null,
    { moved_count: 1, items: [{ record_uid: 'record-a', target_status: 1, target_is_primary: true, source_status: 2 }] },
    { moved_count: 0, items: [], projection_refresh_pending: false },
    { moved_count: 1, projection_refresh_pending: false, items: [{ record_uid: 'other', target_status: 1, target_is_primary: true }] },
    { moved_count: 1, projection_refresh_pending: false, items: [{ record_uid: 'record-a', target_status: 1, target_is_primary: false }] },
  ])('does not report success for incomplete owner result %#', async response => {
    const { service, post } = fixture()
    post.mockResolvedValue(response as never)
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref()], targetSourceRef: 'target' }))
      .rejects.toMatchObject({ writeOutcomeUnknown: true })
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('rejects an account change during reference resolution', async () => {
    const { service, runtime, post } = fixture()
    runtime.requireSession.mockResolvedValueOnce({ userId: 42 }).mockResolvedValue({ userId: 99 })
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref()], targetSourceRef: 'target' }))
      .rejects.toMatchObject({ code: 'account-changed' })
    expect(post).not.toHaveBeenCalled()
  })
  it('honors cancellation before any owner write', async () => {
    const { service, post } = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref()], targetSourceRef: 'target' }, controller.signal)).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
  it('does not fallback or retry a failed batch', async () => {
    const { service, post } = fixture()
    post.mockRejectedValue(new Error('timeout'))
    await expect(service.assign({ sourceRef: 'self', assignmentRefs: [ref()], targetSourceRef: 'target' })).rejects.toThrow()
    expect(post).toHaveBeenCalledTimes(1)
  })
})
