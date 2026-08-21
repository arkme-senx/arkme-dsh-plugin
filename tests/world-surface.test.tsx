import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeWorldContent, ArkmeWorldSurface, voiceprintInvitePromptTitle, type ArkmeWorldViewState } from '../src/client/ArkmeWorldSurface.js'
import type { ArkmeWorldFeedItem } from '../src/types.js'

const noop = () => {}
const actions = {
  onRefresh: noop,
  onSelectScope: noop,
  onOpenComposer: noop,
  onOpenInteractions: noop,
  onToggleVoiceprint: noop,
}

const item: ArkmeWorldFeedItem = {
  recordRef: 'world_1',
  authorName: '陈一涵',
  headline: '一段世界标题',
  textContent: '世界正文',
  tags: [],
  templateKind: 0,
  createdAtMillis: 1_700_000_000_000,
  publishedAtMillis: 1_700_000_000_000,
  imageRefs: [],
  imageCount: 0,
  videoCount: 0,
  voiceCount: 0,
  extendCount: 2,
}

function render(state: ArkmeWorldViewState, playableRefs: ReadonlySet<string> = new Set(['world_1']), interactionRecordRef?: string) {
  return renderToStaticMarkup(<ArkmeWorldContent
    state={state}
    scope="all"
    voiceprintPlayableRefs={playableRefs}
    voiceprintRecordRef={undefined}
    {...(interactionRecordRef === undefined ? {} : { interactionRecordRef })}
    {...actions}
  />)
}

describe('Arkme native World surface', () => {
  it('owns a full-page surface and keeps all original controls visible while loading', () => {
    const markup = renderToStaticMarkup(<ArkmeWorldSurface />)

    expect(markup).toContain('data-arkme-owned="world-surface"')
    expect(markup).toContain('width:100%')
    expect(markup).toContain('height:100%')
    expect(markup).toContain('>世界<')
    expect(markup).toContain('>我的世界<')
    expect(markup).toContain('>发世界<')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup).not.toContain('>关闭<')
  })

  it('covers loading, error, empty, and success states without hiding actions', () => {
    expect(render({ status: 'loading', items: [] })).toContain('正在加载世界')

    const error = render({ status: 'error', items: [], message: 'Provider 暂不支持' })
    expect(error).toContain('Provider 暂不支持')
    expect(error).toContain('>重试<')
    expect(error).toContain('>发世界<')

    expect(render({ status: 'empty', items: [] })).toContain('这里还没有世界动态')

    const success = render({ status: 'success', items: [item] })
    expect(success).toContain('陈一涵')
    expect(success).toContain('一段世界标题')
    expect(success).toContain('世界正文')
    expect(success).toContain('评论：2')
    expect(success).toContain('aria-label="播放陈一涵的声纹"')
    expect(success).not.toContain('用发布者的声音朗读')
    expect(success).not.toContain('查看 2 条互动')

    const unavailable = render({ status: 'success', items: [item] }, new Set())
    expect(unavailable).toContain('aria-label="邀请陈一涵开启声纹"')

    const refreshFailure = render({ status: 'success', items: [item], message: '刷新失败，保留旧内容' })
    expect(refreshFailure).toContain('刷新失败，保留旧内容')
    expect(refreshFailure).toContain('世界正文')
  })

  it('expands comments inline beneath the selected world card instead of opening a modal', () => {
    const markup = render({ status: 'success', items: [item] }, new Set(['world_1']), 'world_1')

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-controls="world-comments-world_1"')
    expect(markup).toContain('aria-label="陈一涵的评论区"')
    expect(markup).toContain('评论加载中')
    expect(markup).toContain('写一条评论')
    expect(markup).toContain('>收起<')
    expect(markup).not.toContain('互动详情')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup.match(/世界正文/g)).toHaveLength(1)
  })

  it('derives the voiceprint invite confirmation from the world content', () => {
    expect(voiceprintInvitePromptTitle(item)).toBe('是否邀请陈一涵朗读「一段世界标题」？')
    expect(voiceprintInvitePromptTitle({ ...item, headline: '', textContent: '今天真的很需要休息一下，明天再重新开始' })).toContain('今天真的很需要休息一下')
  })
})
