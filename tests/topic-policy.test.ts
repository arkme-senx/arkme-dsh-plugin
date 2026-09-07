import { describe, expect, it, vi } from 'vitest'
import { arkmeSourceAllowsUserWrite, isArkmeDSHInputTopic } from '../src/topic-policy.js'
import { canMoveArkmeTopicToParent } from '../src/client/source-tree.js'
import { SourceService } from '../src/services/source-service.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { topicHomeVisibilityToolModule } from '../src/tools/business/conversation/topic-home-visibility.js'
import type { ArkmeSourceItem } from '../src/types.js'

const archive: ArkmeSourceItem = { sourceRef: 'archive', kind: 'topic', topicKind: 3, displayName: 'Archive', activeAtMillis: 0, unreadCount: 0 }
const ordinary: ArkmeSourceItem = { ...archive, sourceRef: 'ordinary', topicKind: 1, displayName: 'DSH Agent Input' }

describe('DSH topic policy', () => {
  it('uses topic kind, not title, source category or record provenance', () => {
    expect(isArkmeDSHInputTopic(archive)).toBe(true)
    expect(isArkmeDSHInputTopic(ordinary)).toBe(false)
    expect(isArkmeDSHInputTopic({ ...archive, kind: 'group_chat' })).toBe(false)
    expect(arkmeSourceAllowsUserWrite(archive)).toBe(false)
    expect(arkmeSourceAllowsUserWrite(ordinary)).toBe(true)
    expect(canMoveArkmeTopicToParent(archive, undefined, [archive])).toBe(false)
    expect(canMoveArkmeTopicToParent(ordinary, archive, [ordinary, archive])).toBe(false)
    expect(canMoveArkmeTopicToParent(ordinary, undefined, [ordinary])).toBe(true)
  })

  it('uses the existing policy endpoint and never replays name/privacy defaults', async () => {
    const session = { userId: 42 }
    const post = vi.fn().mockResolvedValueOnce({ topic_core: { show_in_home: false } }).mockResolvedValueOnce({ show_in_home: true })
    const service = new SourceService({ requireSession: async () => session, authenticatedPost: post } as never, {} as never, {} as never)
    vi.spyOn(service, 'openSourceRef').mockResolvedValue({ version: 1, userId: 42, kind: 'topic', ownerRef: 'owned-topic', displayName: 'Archive' })
    expect(await service.topicHomeVisibility('opaque')).toEqual({ showInHome: false })
    expect(await service.topicHomeVisibility('opaque', true)).toEqual({ showInHome: true })
    expect(post.mock.calls[1]).toEqual(['/api/v1/topics/display/policy/set', { topic_uid: 'owned-topic', show_in_home: true }, session])
    post.mockResolvedValueOnce({})
    await expect(service.topicHomeVisibility('opaque')).rejects.toMatchObject({ code: 'topic-policy-contract-invalid' })
    vi.mocked(service.openSourceRef).mockRejectedValueOnce(new Error('wrong account'))
    post.mockClear()
    await expect(service.topicHomeVisibility('opaque', false)).rejects.toThrow('wrong account')
    expect(post).not.toHaveBeenCalled()
  })

  it('SDK reads and sets through the same Host contract with no human-source input', async () => {
    const requests: unknown[] = []
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ ok: true, value: { showInHome: false } }))
    } })
    await sdk.topicHomeVisibility('opaque')
    await sdk.topicHomeVisibility('opaque', false)
    expect(requests).toEqual([
      { operation: 'topic.home-visibility', params: { sourceRef: 'opaque' } },
      { operation: 'topic.home-visibility', params: { sourceRef: 'opaque', showInHome: false } },
    ])
    await expect(sdk.topicHomeVisibility('')).rejects.toThrow()
  })

  it('Tool delegates to the same owner and requires explicit-user-write grant', async () => {
    const owner = vi.fn().mockResolvedValue({ showInHome: true })
    const tool = topicHomeVisibilityToolModule.create({ topicHomeVisibility: owner } as never)
    expect(topicHomeVisibilityToolModule.meta.grant).toBe('explicit-user-write')
    await tool.execute!({ source_ref: 'opaque', show_in_home: true } as never, {} as never)
    expect(owner).toHaveBeenCalledWith('opaque', true)
  })
})
