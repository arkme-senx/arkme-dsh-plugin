// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import * as api from '../src/client/api.js'
import { ArkmeWorldSurface } from '../src/client/ArkmeWorldSurface.js'

it('opens the original post, loads a later reply page, and can return to the full World feed', async () => {
  const root = { recordRef: 'original', authorName: '原作者', headline: '他人的世界', textContent: '原文', tags: [],
    templateKind: 0, createdAtMillis: 1000, publishedAtMillis: 1000, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 2 }
  const comment = { interactionRef: 'my-comment', parentRef: 'original', authorName: '我', textContent: '我的评论',
    createdAtMillis: 1100, publishedAtMillis: 1100, imageCount: 0, videoCount: 0, voiceCount: 0 }
  const reply = { ...comment, interactionRef: 'target-reply', parentRef: 'my-comment', authorName: '原作者', textContent: '对我的回复' }
  const request = vi.spyOn(api, 'callArkme').mockImplementation(async (operation, params) => {
    if (operation === 'world.notification-target') return { root, interactionRef: 'target-reply' }
    if (operation === 'world.interactions.list') return params.offset === 0
      ? { items: [comment], hasMore: true, nextOffset: 50 }
      : { items: [reply], hasMore: false }
    if (operation === 'world.voiceprint.availability') return []
    return { items: [], hasMore: false }
  })
  let view: ReactTestRenderer | undefined
  try {
    await act(async () => { view = create(<ArkmeWorldSurface notificationRef="target-reply" />) })
    expect(request).toHaveBeenCalledWith('world.notification-target', { interactionRef: 'target-reply' }, expect.any(AbortSignal))
    expect(request).toHaveBeenCalledWith('world.interactions.list', { recordRef: 'original', limit: 50, offset: 50 }, expect.any(AbortSignal))
    expect(view!.root.findAllByProps({ 'data-world-notification-focus': true })).toHaveLength(1)
    expect(request.mock.calls.some(([operation]) => operation === 'world.interactions.mark-viewed')).toBe(false)
    await act(async () => { view!.root.findAllByType('button').find(node => node.props.children === '世界')!.props.onClick() })
    expect(request.mock.calls.some(([operation]) => operation === 'world.feed')).toBe(true)
    expect(view!.root.findAllByProps({ 'data-world-notification-focus': true })).toHaveLength(0)
  } finally {
    await act(async () => { view?.unmount() })
    request.mockRestore()
  }
})
