import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  appendWorldPublishFiles,
  ArkmeWorldContent,
  ArkmeWorldSurface,
  cachedWorldImageDataUrl,
  cachedWorldVoiceprintPlayableRefs,
  cachedWorldVoiceprintResolvedRefs,
  loadWorldImageDataUrl,
  mergeWorldVoiceprintPlayableRefs,
  optimizeWorldPublishImage,
  pendingWorldVoiceprintRecordRefs,
  PublishDialog,
  rememberWorldVoiceprintAvailability,
  removeWorldPublishFile,
  VoiceprintInviteDialog,
  WorldInfiniteScrollTrigger,
  WorldImagePreviewDialog,
  WorldImagePreviewMedia,
  WorldInteractionPreviewContent,
  WorldInteractionThreadList,
  voiceprintInvitePromptTitle,
  worldImagePreviewDragPosition,
  worldInteractionCountLabel,
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
    expect(markup).toContain('aria-label="发世界"')
    expect(markup).toContain('>发布</button>')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup).not.toContain('>关闭<')
  })

  it('renders a spacious World publisher with a custom image picker and complete action area', () => {
    const markup = renderToStaticMarkup(<PublishDialog onClose={noop} onPublished={noop} />)

    expect(markup).toContain('data-world-publish-dialog="spacious"')
    expect(markup).toContain('width:min(720px, 100%)')
    expect(markup).toContain('data-world-publish-editor="true"')
    expect(markup).toContain('min-height:190px')
    expect(markup).toContain('aria-label="世界内容"')
    expect(markup).toContain('data-world-publish-images="true"')
    expect(markup).toContain('>添加图片<')
    expect(markup).toContain('0 / 9')
    expect(markup).toContain('0 / 2000')
    expect(markup).toContain('aria-label="关闭发布窗口"')
    expect(markup).not.toContain('选择文件')
  })

  it('appends publish images up to the product limit and removes one selection without touching the others', () => {
    const image = (name: string) => ({ name, size: 1, type: 'image/png', lastModified: 1 } as File)
    const current = [image('1.png'), image('2.png')]
    const appended = appendWorldPublishFiles(current, Array.from({ length: 10 }, (_value, index) => image(`${String(index + 3)}.png`)))

    expect(appended.map(file => file.name)).toEqual(['1.png', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png', '8.png', '9.png'])
    expect(removeWorldPublishFile(appended, 3).map(file => file.name)).toEqual(['1.png', '2.png', '3.png', '5.png', '6.png', '7.png', '8.png', '9.png'])
  })

  it('keeps an already small publish image byte-for-byte instead of doing unnecessary work', async () => {
    const file = { name: 'small.png', size: 1024, type: 'image/png', lastModified: 1 } as File

    await expect(optimizeWorldPublishImage(file)).resolves.toBe(file)
  })

  it('covers loading, error, empty, and success states without hiding actions', () => {
    expect(render({ status: 'loading', items: [] })).toContain('正在加载世界')

    const error = render({ status: 'error', items: [], message: 'Provider 暂不支持' })
    expect(error).toContain('Provider 暂不支持')
    expect(error).toContain('>重试<')
    expect(error).toContain('aria-label="发世界"')

    expect(render({ status: 'empty', items: [] })).toContain('这里还没有世界动态')

    const success = render({ status: 'success', items: [item] })
    expect(success).toContain('陈一涵')
    expect(success).toContain('一段世界标题')
    expect(success).toContain('世界正文')
    expect(success).toContain('2 条评论')
    expect(success).toContain('aria-label="播放陈一涵的声纹"')
    expect(success).not.toContain('用发布者的声音朗读')
    expect(success).not.toContain('查看 2 条互动')

    const unavailable = render({ status: 'success', items: [item] }, new Set())
    expect(unavailable).toContain('aria-label="邀请陈一涵开启声纹"')

    const withoutComments = render({ status: 'success', items: [{ ...item, extendCount: 0 }] })
    expect(withoutComments).toContain('0 条评论')

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

  it('collapses long World articles to the mobile feed line limits and exposes an accessible toggle', () => {
    const longText = Array.from({ length: 6 }, (_, index) => `第 ${String(index + 1)} 段很长的世界正文`).join('\n')
    const textOnly = render({
      status: 'success',
      items: [{ ...item, textContent: longText }],
    })

    expect(textOnly).toContain('data-world-text-collapsible="true"')
    expect(textOnly).toContain('-webkit-line-clamp:5')
    expect(textOnly).toContain('aria-expanded="false"')
    expect(textOnly).toContain('>展开全文<')

    const withImage = render({
      status: 'success',
      items: [{ ...item, textContent: longText, imageRefs: ['image-ref'], imageCount: 1 }],
    })
    expect(withImage).toContain('-webkit-line-clamp:3')

    const shortText = render({ status: 'success', items: [item] })
    expect(shortText).not.toContain('data-world-text-collapsible="true"')
    expect(shortText).not.toContain('>展开全文<')
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

  it('reuses confirmed voiceprint availability when the World surface is opened again', () => {
    const recordRef = 'world_cached_voiceprint'
    rememberWorldVoiceprintAvailability({ items: [{ recordRef, playable: true }] })

    expect(cachedWorldVoiceprintResolvedRefs()).toContain(recordRef)
    expect(cachedWorldVoiceprintPlayableRefs()).toContain(recordRef)
    expect(pendingWorldVoiceprintRecordRefs([{ recordRef }], cachedWorldVoiceprintResolvedRefs())).toEqual([])
  })

  it('deduplicates World image reads and renders a cached image without a loading placeholder', async () => {
    const imageRef = 'world_cached_image'
    const reader = vi.fn(async () => ({ mediaType: 'image/png' as const, bytes: 5, dataBase64: 'aGVsbG8=' }))

    await expect(loadWorldImageDataUrl(imageRef, reader)).resolves.toBe('data:image/png;base64,aGVsbG8=')
    await expect(loadWorldImageDataUrl(imageRef, reader)).resolves.toBe('data:image/png;base64,aGVsbG8=')

    expect(reader).toHaveBeenCalledOnce()
    expect(cachedWorldImageDataUrl(imageRef)).toBe('data:image/png;base64,aGVsbG8=')
    const markup = renderToStaticMarkup(<WorldImagePreviewMedia imageRef={imageRef} alt="缓存图片" />)
    expect(markup).toContain('src="data:image/png;base64,aGVsbG8="')
    expect(markup).not.toContain('data-world-image-preview-loading')
  })

  it('uses the demo compact white-feed language without introducing demo-only actions', () => {
    const markup = render({ status: 'success', items: [item] })

    expect(markup).toContain('width:min(980px, 100%);min-height:90px;margin:0 auto;padding:34px 48px 0')
    expect(markup).toContain('font-size:26px;line-height:34px;font-weight:650')
    expect(markup).toContain('width:min(980px, 100%);min-height:38px;margin:0 auto 4px;padding:0 48px')
    expect(markup.indexOf('aria-label="发世界"')).toBeLessThan(markup.indexOf('aria-label="世界范围"'))
    expect(markup).toContain('width:min(884px, calc(100% - 96px))')
    expect(markup).toContain('padding:22px 20px 18px')
    expect(markup).toContain('border:1px dashed #d7dbe3')
    expect(markup).toContain('overflow-x:hidden')
    expect(markup).toContain('overflow-wrap:anywhere')
    expect(markup).toContain('border-radius:14px')
    expect(markup).toContain('background:#fff')
    expect(markup).not.toContain('>共鸣<')
    expect(markup).not.toContain('aria-label="分享"')
    expect(markup).not.toContain('正在发生')
    expect(markup).not.toContain('发布前由你确认')
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

  it('shows an explicit cancellable loading state while the first voiceprint chunk is generated', () => {
    const markup = renderToStaticMarkup(<ArkmeWorldContent
      state={{ status: 'success', items: [item] }}
      scope="all"
      voiceprintPlayableRefs={new Set(['world_1'])}
      voiceprintRecordRef="world_1"
      voiceprintLoadingRecordRef="world_1"
      {...actions}
    />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('aria-label="正在生成陈一涵的声纹，点击停止"')
    expect(markup).toContain('arkme-icon-spin')
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
    expect(loading).not.toContain('aria-label="发世界"')
    expect(loading).not.toContain('>我的世界<')

    expect(renderTarget({ status: 'error', items: [], message: '主页加载失败' })).toContain('主页加载失败')
    const empty = renderTarget({ status: 'empty', items: [] })
    expect(empty).toContain('TA 的世界暂无公开内容。')
    expect(empty).toContain('data-arkme-world-empty-state="true"')
    expect(renderTarget({ status: 'success', items: [item] })).toContain('世界正文')
  })

  it('keeps complete comments inline under the selected World item', () => {
    const markup = render({ status: 'success', items: [item] }, new Set(['world_1']), 'world_1')

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-controls="world-comments-world_1"')
    expect(markup).toContain('data-world-layout="comments-open"')
    expect(markup).toContain('data-world-feed-pane="true"')
    expect(markup).toContain('data-world-comment-panel="inline"')
    expect(markup).toContain('aria-label="陈一涵的评论区"')
    expect(markup).toContain('aria-label="收起评论"')
    expect(markup).toContain('data-world-comment-toolbar="sticky"')
    expect(markup).toContain('position:sticky;top:0')
    expect(markup).toContain('width:calc(100% - 4px)')
    expect(markup).toContain('border-radius:12px;background:var(--dsw-alias-bg-subtle, #f5f5f6)')
    expect(markup).toContain('评论加载中')
    expect(markup).toContain('写一条评论')
    expect(markup).toContain('>收起<')
    expect(markup).not.toContain('互动详情')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup.match(/世界正文/g)).toHaveLength(1)
    expect(markup.indexOf('世界正文')).toBeLessThan(markup.indexOf('data-world-comment-panel="inline"'))
    expect(markup.indexOf('写一条评论')).toBeLessThan(markup.indexOf('评论加载中'))
    expect(markup).not.toContain('data-world-comment-panel="side"')
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
    expect(worldInteractionCountLabel(interactions.length)).toBe('评论 4')
    expect(worldInteractionCountLabel(interactions.length, true)).toBe('评论 4+')
  })

  it('places every full comment reply action at the right edge of the final content line', () => {
    const markup = renderToStaticMarkup(<WorldInteractionThreadList rootRef={item.recordRef} items={interactions} onReply={noop} />)

    expect(markup).toContain('grid-template-columns:minmax(0,1fr) auto;align-items:end')
    expect(markup).toContain('align-self:end')
    expect(markup).toContain('aria-label="回复阿七的评论"')
    expect(markup).toContain('aria-label="回复小满的评论"')
  })

  it('renders compact avatar-free feed replies with explicit targets and limits previews to three rows', () => {
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
    expect(markup).toContain('小满</strong><span> 回复 </span><strong')
    expect(markup).toContain('阿七</strong><span>：回复第一条</span>')
    expect(markup).toContain('小周</strong><span> 回复 </span><strong')
    expect(markup).toContain('小满</strong><span>：继续回复</span>')
    expect(markup).not.toContain('aria-label="回复小满的评论"')
    expect(markup).not.toContain('>取消回复<')
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

  it('uses one click target for the compact preview without repeating a view-comments label', () => {
    const markup = renderToStaticMarkup(<WorldInteractionPreviewContent item={{ ...item, extendCount: 8 }} items={interactions} onOpen={noop} />)

    expect(markup).toContain('aria-label="打开陈一涵的评论面板，共 8 条评论"')
    expect(markup).toContain('第一条评论')
    expect(markup).toContain('回复第一条')
    expect(markup).not.toContain('第二条评论')
    expect(markup).not.toContain('查看评论')
    expect(markup).not.toContain('查看全部')
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
