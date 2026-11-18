import { expect, it, vi } from 'vitest'
import { SourceService } from '../../src/services/source-service.js'
import { ArkmePluginError } from '../../src/services/service.js'

function fixture() {
  let userId = 42
  const post = vi.fn(async () => ({ topic_core: { topic_uid: 'archive', kind: 3, privacy_state: 1, show_in_home: false } }))
  const runtime = { requireSession: async () => ({ userId }), authenticatedPost: post,
    stateStore: { uniqueCode: async () => 'viewer-bound-key' } }
  const service = new SourceService(runtime as never, {} as never, {} as never)
  return { service, post, switchAccount: () => { userId = 43 } }
}

it('resolves hidden identity from authenticated metadata without querying records, counts or directories', async () => {
  const { service, post } = fixture()
  const sourceRef = await service.sealSourceRef(42, 'topic', 'archive', 'Legacy archive title')
  const signal = new AbortController().signal
  const source = await service.hiddenTopicSource(sourceRef, signal)
  expect(source).toMatchObject({ kind: 'topic', topicKind: 3, displayName: '发给 DSH 的消息' })
  expect(await service.openSourceRef(source!.sourceRef, 42)).toMatchObject({ ownerRef: 'archive' })
  expect(post).toHaveBeenCalledExactlyOnceWith('/api/v1/topics/display/metadata', { topic_uid: 'archive' }, { userId: 42 }, signal)
})

it.each([[1, 1], [2, 1], [3, 2]])('does not retain topic kind=%s privacy=%s from its title or old hint', async (kind, privacy) => {
  const { service, post } = fixture()
  post.mockResolvedValue({ topic_core: { topic_uid: 'archive', kind, privacy_state: privacy, show_in_home: false } })
  const sourceRef = await service.sealSourceRef(42, 'topic', 'archive', 'DSH Agent Input')
  expect(await service.hiddenTopicSource(sourceRef)).toBeNull()
})

it('rejects another account reference before any metadata read', async () => {
  const { service, post } = fixture()
  const sourceRef = await service.sealSourceRef(43, 'topic', 'archive', 'DSH')
  await expect(service.hiddenTopicSource(sourceRef)).rejects.toBeDefined()
  expect(post).not.toHaveBeenCalled()
})

it.each([403, 404])('reports an unavailable destination for an authoritative %s denial', async status => {
  const { service, post } = fixture()
  post.mockRejectedValue(new ArkmePluginError('owner-denied', 'unavailable', false, status))
  const sourceRef = await service.sealSourceRef(42, 'topic', 'archive', 'DSH')
  expect(await service.hiddenTopicSource(sourceRef)).toBeNull()
})

it('does not convert a temporary service outage or invalid metadata into deletion evidence', async () => {
  const { service, post } = fixture()
  const sourceRef = await service.sealSourceRef(42, 'topic', 'archive', 'DSH')
  const error = new ArkmePluginError('temporary', 'retry', true, 502)
  post.mockRejectedValueOnce(error)
  await expect(service.hiddenTopicSource(sourceRef)).rejects.toBe(error)
  post.mockResolvedValueOnce({ topic_core: { topic_uid: 'wrong-owner', kind: 3, privacy_state: 1, show_in_home: false } })
  await expect(service.hiddenTopicSource(sourceRef)).rejects.toMatchObject({ code: 'topic-metadata-invalid' })
})

it.each(['cancel', 'account'])('does not publish a late hidden destination after %s changes', async scenario => {
  const { service, post, switchAccount } = fixture()
  const sourceRef = await service.sealSourceRef(42, 'topic', 'archive', 'DSH')
  const controller = new AbortController()
  post.mockImplementationOnce(async () => {
    if (scenario === 'cancel') controller.abort()
    else switchAccount()
    return { topic_core: { topic_uid: 'archive', kind: 3, privacy_state: 1, show_in_home: false } }
  })
  await expect(service.hiddenTopicSource(sourceRef, controller.signal)).rejects.toBeDefined()
})
