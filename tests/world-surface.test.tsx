import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeWorldContent,
  ArkmeWorldSurface,
  mergeWorldVoiceprintPlayableRefs,
  pendingWorldVoiceprintRecordRefs,
  VoiceprintInviteDialog,
  WorldInfiniteScrollTrigger,
  WorldImagePreviewDialog,
  WorldImagePreviewMedia,
  WorldInteractionThreadList,
  voiceprintInvitePromptTitle,
  worldImagePreviewDragPosition,
  worldInteractionThreads,
  type ArkmeWorldViewState,
} from '../src/client/ArkmeWorldSurface.js'
import type { ArkmeWorldFeedItem, ArkmeWorldInteractionItem } from '../src/types.js'

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

const interactions: ArkmeWorldInteractionItem[] = [
  {
    interactionRef: 'comment_1', parentRef: 'world_1', authorName: '阿七', textContent: '第一条评论',
    createdAtMillis: 1_700_000_001_000, publishedAtMillis: 1_700_000_001_000,
    imageCount: 0, videoCount: 0, voiceCount: 0,
  },
  {
    interactionRef: 'reply_1', parentRef: 'comment_1', authorName: '小满', textContent: '回复第一条',
    createdAtMillis: 1_700_000_002_000, publishedAtMillis: 1_700_000_002_000,
    imageCount: 0, videoCount: 0, voiceCount: 0,
  },
  {
    interactionRef: 'reply_2', parentRef: 'reply_1', authorName: '小周', textContent: '继续回复',
    createdAtMillis: 1_700_000_003_000, publishedAtMillis: 1_700_000_003_000,
    imageCount: 0, videoCount: 0, voiceCount: 0,
  },
  {
    interactionRef: 'comment_2', parentRef: 'world_1', authorName: '小林', textContent: '第二条评论',
    createdAtMillis: 1_700_000_004_000, publishedAtMillis: 1_700_000_004_000,
    imageCount: 0, videoCount: 0, voiceCount: 0,
  },
]

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

  it('renders mobile-compatible emoji tokens in world posts and comments', () => {
    const feed = render({
      status: 'success',
      items: [{
        ...item,
        headline: '喜欢[jm_emoji:heart_eyes]',
        textContent: '支持[im_emoji:thumb_up]，未知[jm_emoji:not_exists]',
      }],
    })
    expect(feed).toContain('喜欢😍')
    expect(feed).toContain('支持👍，未知[jm_emoji:not_exists]')
    expect(feed).not.toContain('[jm_emoji:heart_eyes]')

    const comments = renderToStaticMarkup(<WorldInteractionThreadList
      rootRef={item.recordRef}
      items={[{ ...interactions[0]!, textContent: '笑哭[jm_emoji:joy_face]' }]}
      compact
    />)
    expect(comments).toContain('笑哭😂')
    expect(comments).not.toContain('[jm_emoji:joy_face]')
  })

  it('keeps existing voiceprint playback state when loading more World items', () => {
    const firstPageAvailability = {
      items: [{ recordRef: 'world_1', playable: true }],
    }
    const firstPagePlayableRefs = mergeWorldVoiceprintPlayableRefs(new Set(), firstPageAvailability)
    const resolvedRefs = new Set(firstPageAvailability.items.map(entry => entry.recordRef))
    const secondPageItem = { ...item, recordRef: 'world_2', authorName: '新页面作者' }

    expect(pendingWorldVoiceprintRecordRefs([item, secondPageItem], resolvedRefs)).toEqual(['world_2'])

    const afterLoadMore = mergeWorldVoiceprintPlayableRefs(firstPagePlayableRefs, {
      items: [{ recordRef: 'world_2', playable: false }],
    })
    expect([...afterLoadMore]).toEqual(['world_1'])

    const afterRefresh = mergeWorldVoiceprintPlayableRefs(afterLoadMore, {
      items: [{ recordRef: 'world_1', playable: false }],
    })
    expect([...afterRefresh]).toEqual([])
  })

  it('loads the next World page from an intersection sentinel and shows an animated loading icon', () => {
    const idle = renderToStaticMarkup(<WorldInfiniteScrollTrigger
      scrollRootRef={{ current: null }}
      loading={false}
      error={false}
      onLoadMore={noop}
    />)
    expect(idle).toContain('data-world-load-more-sentinel="true"')
    expect(idle).not.toContain('<button')
    expect(idle).not.toContain('加载更多')

    const loading = renderToStaticMarkup(<WorldInfiniteScrollTrigger
      scrollRootRef={{ current: null }}
      loading
      error={false}
      onLoadMore={noop}
    />)
    expect(loading).toContain('aria-label="正在加载更多世界动态"')
    expect(loading).toContain('data-world-load-more-spinner="true"')
    expect(loading).toContain('<animateTransform')

    const failed = renderToStaticMarkup(<WorldInfiniteScrollTrigger
      scrollRootRef={{ current: null }}
      loading={false}
      error
      onLoadMore={noop}
    />)
    expect(failed).toContain('>重试</button>')

    const source = readFileSync(new URL('../src/client/ArkmeWorldSurface.tsx', import.meta.url), 'utf8')
    expect(source).toContain('new IntersectionObserver(entries =>')
    expect(source).toContain("rootMargin: '0px 0px 180px 0px'")
  })

  it('renders a target user World homepage with mobile-equivalent back navigation and four states', () => {
    const target = { userId: 7, displayName: '泡泡', avatarFallback: { kind: 'phone_default' as const, colorIndex: 2, label: '泡' } }
    const renderTarget = (state: ArkmeWorldViewState) => renderToStaticMarkup(<ArkmeWorldContent
      state={state}
      scope="all"
      target={target}
      voiceprintPlayableRefs={new Set()}
      voiceprintRecordRef={undefined}
      onBackToWorld={noop}
      {...actions}
    />)

    const loading = renderTarget({ status: 'loading', items: [] })
    expect(loading).toContain('泡泡的世界')
    expect(loading).toContain('aria-label="返回世界"')
    expect(loading).toContain('正在加载 泡泡 的世界')
    expect(loading).not.toContain('>发世界<')
    expect(loading).not.toContain('>我的世界<')

    expect(renderTarget({ status: 'error', items: [], message: '主页加载失败' })).toContain('主页加载失败')
    expect(renderTarget({ status: 'empty', items: [] })).toContain('TA 的世界暂无公开内容')
    expect(renderTarget({ status: 'success', items: [item] })).toContain('世界正文')
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

  it('groups every reply under its top-level comment while preserving the direct reply target', () => {
    const threads = worldInteractionThreads(item.recordRef, interactions)

    expect(threads).toHaveLength(2)
    expect(threads[0]?.root.interactionRef).toBe('comment_1')
    expect(threads[0]?.replies.map(reply => ({ ref: reply.item.interactionRef, replyToName: reply.replyToName }))).toEqual([
      { ref: 'reply_1', replyToName: '阿七' },
      { ref: 'reply_2', replyToName: '小满' },
    ])
    expect(threads[1]?.root.interactionRef).toBe('comment_2')
  })

  it('renders smaller indented replies with explicit targets and limits feed previews to three rows', () => {
    const markup = renderToStaticMarkup(<WorldInteractionThreadList
      rootRef={item.recordRef}
      items={interactions}
      maxVisibleItems={3}
      compact
      replyTargetRef="reply_1"
      onReply={noop}
    />)

    expect(markup).toContain('data-world-comment-level="root"')
    expect(markup).toContain('data-world-comment-level="reply"')
    expect(markup).toContain('font-size:11px')
    expect(markup).toContain('回复 阿七')
    expect(markup).toContain('回复 小满')
    expect(markup).toContain('aria-label="回复小满的评论"')
    expect(markup).toContain('>取消回复<')
    expect(markup).not.toContain('第二条评论')
    expect(markup.indexOf('第一条评论')).toBeLessThan(markup.indexOf('回复第一条'))
    expect(markup.indexOf('回复第一条')).toBeLessThan(markup.indexOf('继续回复'))
  })

  it('contains a 3:4 portrait image inside the preview stage without cropping it', () => {
    const markup = renderToStaticMarkup(<WorldImagePreviewMedia imageRef="portrait-3x4" alt="3:4 竖图" />)
    const zoomedMarkup = renderToStaticMarkup(<WorldImagePreviewMedia imageRef="portrait-3x4" alt="3:4 竖图" zoomed />)

    expect(markup).toContain('role="img"')
    expect(markup).toContain('position:relative;width:100%;height:100%;min-width:0;min-height:0')
    expect(markup).toContain('position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain')
    expect(markup).toContain('data-world-image-preview-loading="true"')
    expect(markup).not.toContain('alt="3:4 竖图"')
    expect(zoomedMarkup).toContain('width:200%;height:200%')
    expect(markup).not.toContain('object-fit:cover')
  })

  it('matches the desktop image viewer chrome without author metadata or a text close button', () => {
    const markup = renderToStaticMarkup(<WorldImagePreviewDialog
      item={{ ...item, imageRefs: ['portrait-3x4', 'landscape'], imageCount: 2 }}
      previewIndex={0}
      onClose={noop}
      onSelect={noop}
    />)

    expect(markup).toContain('aria-label="关闭图片预览"')
    expect(markup).toContain('title="关闭"')
    expect(markup).toContain('<svg')
    expect(markup).toContain('aria-label="上一张图片"')
    expect(markup).toContain('aria-label="下一张图片"')
    expect(markup).toContain('data-world-image-preview-zoomed="false"')
    expect(markup).toContain('cursor:default')
    expect(markup).not.toContain('cursor:zoom-in')
    expect(markup).not.toContain('陈一涵 ·')
    expect(markup).not.toContain('1 / 2')
    expect(markup).not.toContain('>关闭</button>')
  })

  it('pans a zoomed image with desktop-style pointer dragging and never exposes a magnifier cursor', () => {
    expect(worldImagePreviewDragPosition({
      pointerId: 4,
      clientX: 300,
      clientY: 240,
      scrollLeft: 120,
      scrollTop: 180,
    }, 250, 160)).toEqual({ left: 170, top: 260 })

    const feed = render({ status: 'success', items: [{ ...item, imageRefs: ['portrait-3x4'], imageCount: 1 }] })
    expect(feed).toContain('cursor:pointer')
    expect(feed).not.toContain('cursor:zoom-in')
  })

  it('derives the voiceprint invite confirmation from the world content', () => {
    expect(voiceprintInvitePromptTitle(item)).toBe('字不多，更想听TA怎么说')
    expect(voiceprintInvitePromptTitle({ ...item, headline: '', textContent: '今天真的很难过，留下了很多遗憾。' })).toBe('文字里有些情绪，更想听见TA的语气')
    expect(voiceprintInvitePromptTitle({ ...item, headline: '', textContent: '今天真的很难过，留下了很多遗憾。' }, 1)).toBe('这段情绪藏在字里，想听TA怎么说')
  })

  it('matches the mobile reminder dialog while preserving the existing confirm callback', () => {
    const markup = renderToStaticMarkup(<VoiceprintInviteDialog
      item={{ ...item, textContent: '哈哈，这件事也太搞笑了！' }}
      variantIndex={0}
      sending={false}
      onClose={noop}
      onConfirm={noop}
    />)

    expect(markup).toContain('这段很有画面，带上声音会更有趣')
    expect(markup).toContain('提醒「陈一涵」录入声纹后就能听见这条文字')
    expect(markup).toContain('>再想想<')
    expect(markup).toContain('>让TA知道<')
    expect(markup).not.toContain('哈哈，这件事也太搞笑了')
    expect(markup).not.toContain('点击提醒后')
  })

  it('shows the mobile relationship line selected by the same presentation index', () => {
    const markup = renderToStaticMarkup(<VoiceprintInviteDialog
      item={item}
      variantIndex={1}
      socialContext={{ relations: [
        {
          type: 'private_chat', displayLine: '你们曾经聊过',
          reasonCode: 'relationship_chat', reasonLabel: '因为我们以前聊过',
        },
        {
          type: 'world_interaction', displayLine: '你们曾在世界回应过彼此',
          reasonCode: 'relationship_world', reasonLabel: '因为我们在世界里回应过彼此',
        },
      ] }}
      sending={false}
      onClose={noop}
      onConfirm={noop}
    />)

    expect(markup).toContain('你们曾在世界回应过彼此')
    expect(markup).not.toContain('你们曾经聊过')
    expect(markup).toContain('>让TA知道<')
  })
})
