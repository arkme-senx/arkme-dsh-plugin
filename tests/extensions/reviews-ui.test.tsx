import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeExtensionReviews,
  ArkmeExtensionReviewComposerDialog,
  ArkmeExtensionReplyListDialog,
  extensionRatingLabel,
  extensionReviewComposerCanSubmit,
  extensionReviewCreateParams,
  extensionReviewReplyCount,
  extensionReviewTree,
} from '../../src/client/ArkmeExtensionReviews.js'
import type { ArkmeExtensionReviewPage } from '../../src/extensions/types.js'

const page: ArkmeExtensionReviewPage = {
  items: [
    {
      reviewRef: 'review-root', authorName: '小林', authorArkmeId: 'lin', textContent: '很好用',
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
  it('renders top-level comments with a reply icon and existing reply count', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviews extensionId="ext-1" initialPage={page} />)

    expect(html).toContain('用户评价')
    expect(html).toContain('5.0 · 1 个评分')
    expect(html).toContain('很好用')
    expect(html).not.toContain('谢谢反馈')
    expect(html).toContain('>评论</button>')
    expect(html).toContain('aria-label="查看小林的评论及 1 条回复"')
    expect(html).toContain('aria-label="回复小林，已有 1 条回复"')
    expect(html).toContain('<svg aria-hidden="true" width="15" height="15"')
    expect(html).toContain('d="M8.5 19H8C4 19 2 18 2 13V8C2 4 4 2 8 2H16C20 2 22 4 22 8V13C22 17 20 19 16 19H15.5')
    expect(html).toContain('d="M7 8H17"')
    expect(html).toContain('d="M7 13H13"')
  })

  it('hides the top-level comment entry for the extension owner while keeping replies', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviews
      extensionId="ext-1" canCreateTopLevelReview={false} initialPage={page}
    />)

    expect(html).not.toContain('>评论</button>')
    expect(html).toContain('aria-label="回复小林，已有 1 条回复"')
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
    expect(html).toContain('aria-label="回复作者，已有 0 条回复"')
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
