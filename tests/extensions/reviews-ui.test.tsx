import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeExtensionReviews,
  applyCreatedExtensionReview,
  ArkmeExtensionInlineReviewComposer,
  ArkmeExtensionReviewComposerDialog,
  ArkmeExtensionReplyListDialog,
  extensionRatingLabel,
  extensionReviewComposerCanSubmit,
  extensionReviewComposerMode,
  extensionReviewComposerTargets,
  extensionReviewCreateParams,
  extensionReviewReplyCount,
  extensionReviewTree,
} from '../../src/client/ArkmeExtensionReviews.js'
import type { ArkmeExtensionReviewPage } from '../../src/extensions/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

function content(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(content).join('')
  if (value !== null && typeof value === 'object' && 'children' in value) return content((value as { children?: unknown }).children)
  if (value !== null && typeof value === 'object' && 'props' in value) return content((value as { props?: { children?: unknown } }).props?.children)
  return ''
}

beforeEach(() => { mocks.callArkme.mockReset() })

const page: ArkmeExtensionReviewPage = {
  items: [
    {
      reviewRef: 'review-root', authorName: '小林', authorArkmeId: 'lin', textContent: '很好用',
      authorAvatarFallback: { kind: 'phone_default', colorIndex: 7, label: '林' },
      rating: 5, createdAtMillis: 1_780_000_000_000,
    },
    {
      reviewRef: 'review-reply', parentReviewRef: 'review-root', authorName: '作者', textContent: '谢谢反馈',
      rating: 0, createdAtMillis: 1_780_000_001_000,
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
  hasMore: false,
  ratingSummary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] },
}

describe('extension reviews UI', () => {
  it('renders an inline composer, comments, and replies without opening another dialog', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviews extensionId="ext-1" initialPage={page} />)

    expect(html).toContain('用户评价')
    expect(html).toContain('2 条评论')
    expect(html).toContain('5.0 · 1 个评分')
    expect(html).toContain('很好用')
    expect(html).toContain('谢谢反馈')
    expect(html).toContain('data-extension-review-composer="inline"')
    expect(html).toContain('placeholder="分享你的使用体验"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('>评论</button>')
    expect(html).toContain('aria-label="回复小林"')
    expect(html).toContain('aria-label="回复作者"')
    expect(html).toContain('aria-label="小林头像"')
    expect(html).toContain('grid-template-columns:34px minmax(0, 1fr)')
    expect(html).toContain('width:34px;height:34px')
    expect(html).not.toContain('@lin')
    const mainColumn = html.indexOf('data-arkme-review-main="true"')
    const author = html.indexOf('小林', mainColumn)
    const rating = html.indexOf('aria-label="5.0 星"', author)
    const content = html.indexOf('很好用', rating)
    const replies = html.indexOf('aria-label="回复小林"', content)
    expect(mainColumn).toBeGreaterThan(-1)
    expect(author).toBeGreaterThan(mainColumn)
    expect(rating).toBeGreaterThan(author)
    expect(content).toBeGreaterThan(rating)
    expect(replies).toBeGreaterThan(content)
    expect(html).toContain('data-extension-review-actions="hover"')
    expect(html).toContain('data-extension-review-reply-action="true"')
    expect(html).toContain('title="回复"')
    expect(html).toContain('opacity:0')
    expect(html).not.toContain('已有 0 条回复')
    expect(html).not.toContain('<span>0</span>')
    expect(html).toContain('<svg aria-hidden="true" width="15" height="15"')
    expect(html).toContain('d="M9 8L4 12L9 16"')
  })

  it('patches a created review locally without discarding already loaded pagination', async () => {
    const paged = { ...page, hasMore: true, nextOffset: 40 }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'extensions.reviews.create') return {
        review: {
          reviewRef: 'review-new', authorName: '我', textContent: '分页仍然保留', rating: 4,
          createdAtMillis: 1_780_000_002_000,
        },
        ratingSummary: { average: 4.5, count: 2, histogram: [0, 0, 0, 1, 1] },
        idempotentReplay: false,
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeExtensionReviews extensionId="ext-1" initialPage={paged} />) })

    act(() => { renderer.root.findByProps({ 'aria-label': '4 星' }).props.onClick() })
    act(() => { renderer.root.findByProps({ placeholder: '分享你的使用体验' }).props.onChange({ target: { value: '分页仍然保留' } }) })
    await act(async () => {
      renderer.root.findAllByType('button').find(button => content(button.props.children) === '发布')?.props.onClick()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).toHaveBeenCalledWith('extensions.reviews.create', expect.objectContaining({
      extensionId: 'ext-1', textContent: '分页仍然保留', rating: 4,
    }))
    expect(content(renderer.toJSON())).toContain('3 条评论')
    expect(content(renderer.toJSON())).toContain('分页仍然保留')
    expect(renderer.root.findAllByType('button').some(button => content(button.props.children) === '加载更多')).toBe(true)
    act(() => { renderer.unmount() })
  })

  it('does not increase the top-level total for replies or idempotent replays', () => {
    const replyResult = {
      review: {
        reviewRef: 'reply-new', parentReviewRef: page.items[0]!.reviewRef,
        authorName: '我', textContent: '回复', rating: 0, createdAtMillis: 2,
      },
      ratingSummary: page.ratingSummary,
      idempotentReplay: false,
    }
    expect(applyCreatedExtensionReview(page, replyResult).total).toBe(page.total)
    expect(applyCreatedExtensionReview(page, {
      ...replyResult,
      review: { ...replyResult.review, reviewRef: 'review-replayed', parentReviewRef: undefined, rating: 5 },
      idempotentReplay: true,
    }).total).toBe(page.total)
  })

  it('merges a local create when the initial list response arrives later', async () => {
    let resolveList!: (value: ArkmeExtensionReviewPage) => void
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'extensions.reviews.list') {
        return await new Promise<ArkmeExtensionReviewPage>(resolve => { resolveList = resolve })
      }
      if (operation === 'extensions.reviews.create') return {
        review: {
          reviewRef: 'review-race', authorName: '我', textContent: '保留本地创建', rating: 5,
          createdAtMillis: 1_780_000_003_000,
        },
        ratingSummary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] },
        idempotentReplay: false,
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeExtensionReviews extensionId="ext-race" />); await Promise.resolve() })
    act(() => { renderer.root.findByProps({ 'aria-label': '5 星' }).props.onClick() })
    act(() => { renderer.root.findByProps({ placeholder: '分享你的使用体验' }).props.onChange({ target: { value: '保留本地创建' } }) })
    await act(async () => {
      renderer.root.findAllByType('button').find(button => content(button.props.children) === '发布')?.props.onClick()
      await Promise.resolve()
    })

    await act(async () => {
      resolveList({ items: [], total: 0, limit: 20, offset: 0, hasMore: false, ratingSummary: page.ratingSummary })
      await Promise.resolve()
    })

    expect(content(renderer.toJSON())).toContain('保留本地创建')
    expect(content(renderer.toJSON())).toContain('1 条评论')
    act(() => { renderer.unmount() })
  })

  it('hides the top-level comment entry for the extension owner while keeping replies', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviews
      extensionId="ext-1" canCreateTopLevelReview={false} initialPage={page}
    />)

    expect(html).not.toContain('data-extension-review-composer="inline"')
    expect(html).toContain('aria-label="回复小林"')
  })

  it('uses one composer slot and lets reply mode replace the top-level entry', () => {
    expect(extensionReviewComposerMode(true, false)).toBe('top-level')
    expect(extensionReviewComposerMode(true, true)).toBe('reply')
    expect(extensionReviewComposerMode(false, true)).toBe('reply')
    expect(extensionReviewComposerMode(false, false)).toBe('hidden')

    const html = renderToStaticMarkup(<ArkmeExtensionInlineReviewComposer
      state={{ parent: page.items[0], textContent: '', rating: 0, clientMutationId: 'reply-1', error: '' }}
      submitting={false} onChange={() => undefined} onSubmit={() => undefined} onCancel={() => undefined}
    />)
    expect(html).toContain('>回复 小林</div>')
    expect(html).toContain('placeholder="输入回复内容…"')
    expect(html).not.toContain('placeholder="回复 小林"')
    expect(html).toContain('grid-template-columns:30px minmax(0, 1fr)')
    expect(html).toContain('min-height:42px')
    expect(html).toContain('max-height:160px')
    expect(html).toContain('resize:vertical')
    expect(html).toContain('overflow-y:auto')
    expect(extensionReviewComposerTargets('review-root', {
      parent: page.items[0], textContent: '', rating: 0, clientMutationId: 'reply-1', error: '',
    })).toBe(true)
    expect(extensionReviewComposerTargets('review-reply', {
      parent: page.items[0], textContent: '', rating: 0, clientMutationId: 'reply-1', error: '',
    })).toBe(false)
  })

  it('projects the authenticated user avatar into top-level and reply composers', () => {
    const topLevel = ArkmeExtensionInlineReviewComposer({
      state: { textContent: '', rating: 0, clientMutationId: '', error: '' },
      submitting: false,
      currentUserAvatarRef: 'profile-avatar-ref',
      onChange: () => undefined,
      onSubmit: () => undefined,
    }) as unknown as { props: { children: Array<{ props: { avatarRef?: string } }> } }
    const reply = ArkmeExtensionInlineReviewComposer({
      state: { parent: page.items[0], textContent: '', rating: 0, clientMutationId: '', error: '' },
      submitting: false,
      currentUserAvatarRef: 'profile-avatar-ref',
      onChange: () => undefined,
      onSubmit: () => undefined,
    }) as unknown as { props: { children: Array<{ props: { avatarRef?: string } }> } }

    expect(topLevel.props.children[0]?.props.avatarRef).toBe('profile-avatar-ref')
    expect(reply.props.children[0]?.props.avatarRef).toBe('profile-avatar-ref')
  })

  it('uses an owner-specific empty state without inviting a self rating', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviews
      extensionId="ext-1"
      canCreateTopLevelReview={false}
      initialPage={{ ...page, items: [], total: 0, ratingSummary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] } }}
    />)

    expect(html).toContain('还没有用户评价。')
    expect(html).not.toContain('来发表第一条评价')
  })

  it('groups replies and enforces top-level rating while replies omit it', () => {
    const tree = extensionReviewTree(page.items)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.children[0]?.item.reviewRef).toBe('review-reply')
    expect(extensionReviewReplyCount(tree[0]!)).toBe(1)
    expect(extensionRatingLabel(page.ratingSummary)).toBe('5.0 · 1 个评分')
    expect(extensionReviewComposerCanSubmit({ textContent: '评价', rating: 0, replying: false })).toBe(false)
    expect(extensionReviewComposerCanSubmit({ textContent: '回复', rating: 0, replying: true })).toBe(true)
    expect(extensionReviewCreateParams('ext-1', {
      parent: page.items[0], textContent: '回复', rating: 0, clientMutationId: 'mutation-1', error: '',
    })).toEqual({
      extensionId: 'ext-1', textContent: '回复', parentReviewRef: 'review-root', clientMutationId: 'mutation-1',
    })
  })

  it('renders the shared comment composer with rating and home-page disclosure', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviewComposerDialog
      state={{ textContent: '真实体验', rating: 4, clientMutationId: 'mutation-1', error: '' }}
      submitting={false} onChange={() => undefined} onClose={() => undefined} onSubmit={() => undefined}
    />)

    expect(html).toContain('role="dialog"')
    expect(html).toContain('发表评价')
    expect(html).toContain('普通快记')
    expect(html).toContain('aria-label="4 星"')
    expect(html).toContain('发表评论')
  })

  it('renders a reply list dialog with the original comment and all replies', () => {
    const root = extensionReviewTree(page.items)[0]!
    const html = renderToStaticMarkup(<ArkmeExtensionReplyListDialog
      root={root} onClose={() => undefined} onReply={() => undefined}
    />)

    expect(html).toContain('评论回复')
    expect(html).toContain('原评论')
    expect(html).toContain('很好用')
    expect(html).toContain('全部回复 1')
    expect(html).toContain('谢谢反馈')
    expect(html).toContain('aria-label="回复作者"')
    expect(html).toContain('aria-label="作者头像"')
    expect(html).toContain('<circle cx="12" cy="8" r="4"></circle>')
  })

  it('shows the original text in the reply composer', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviewComposerDialog
      state={{ parent: page.items[0], textContent: '', rating: 0, clientMutationId: 'mutation-2', error: '' }}
      submitting={false} onChange={() => undefined} onClose={() => undefined} onSubmit={() => undefined}
    />)

    expect(html).toContain('回复 小林')
    expect(html).toContain('回复原文')
    expect(html).toContain('很好用')
    expect(html).not.toContain('选择评分')
  })
})
