// @vitest-environment jsdom
import { useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import * as api from '../src/client/api.js'
import { WorldCard } from '../src/client/ArkmeWorldSurface.js'
import type { ArkmeWorldFeedItem, ArkmeWorldInteractionPage } from '../src/types.js'

it('focuses the composer before comments arrive and preserves its draft when Comment is clicked again', async () => {
  let resolveComments!: (page: ArkmeWorldInteractionPage) => void
  const request = vi.spyOn(api, 'callArkme').mockImplementation(() => new Promise(resolve => { resolveComments = resolve }))
  const focus = vi.fn()
  const item: ArkmeWorldFeedItem = { recordRef: 'post', authorName: '作者', headline: '', textContent: '公开正文',
    tags: [], templateKind: 0, createdAtMillis: 1000, publishedAtMillis: 1000, imageRefs: [], imageCount: 0,
    videoCount: 0, voiceCount: 0, extendCount: 0 }
  function Card() {
    const [open, setOpen] = useState(false)
    return <WorldCard item={item} playable={false} voiceprintActive={false} voiceprintLoading={false}
      interactionsOpen={open} onOpenInteractions={() => setOpen(current => !current)}
      onInteractionCreated={() => {}} onToggleVoiceprint={() => {}} />
  }
  let ui: ReactTestRenderer | undefined
  try {
    await act(async () => { ui = create(<Card />, { createNodeMock: node => node.type === 'textarea' ? { focus } : null }) })
    const button = () => ui!.root.findByProps({ 'aria-label': '评论' })
    await act(async () => { button().props.onClick() })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(ui!.root.findByProps({ 'data-world-comment-panel': 'inline' })).toBeDefined()
    expect(JSON.stringify(ui!.toJSON())).toContain('评论加载中')
    expect(request).toHaveBeenCalledOnce()
    await act(async () => { ui!.root.findByType('textarea').props.onChange({ currentTarget: { value: '尚未发送的评论', style: {}, scrollHeight: 40 } }) })
    await act(async () => { button().props.onClick() })
    expect(focus).toHaveBeenCalledTimes(2)
    expect(ui!.root.findByType('textarea').props.value).toBe('尚未发送的评论')
    expect(request).toHaveBeenCalledOnce()
    await act(async () => { resolveComments({ items: [{ interactionRef: 'comment', parentRef: 'post', authorName: '读者',
      textContent: '已有评论', createdAtMillis: 2000, publishedAtMillis: 2000, imageCount: 0, videoCount: 0, voiceCount: 0 }], hasMore: false }) })
    expect(JSON.stringify(ui!.toJSON())).toContain('已有评论')
    expect(ui!.root.findByType('textarea').props.value).toBe('尚未发送的评论')
    expect(button().findAllByType('svg')).toHaveLength(1)
    await act(async () => { ui!.root.findByProps({ 'aria-label': '收起评论' }).props.onClick() })
    expect(ui!.root.findAllByType('textarea')).toHaveLength(0)
  } finally { await act(async () => { ui?.unmount() }); request.mockRestore() }
})
