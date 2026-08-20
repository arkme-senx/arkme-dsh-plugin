import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeExtensionReviews,
  ArkmeExtensionReviewComposerDialog,
  extensionRatingLabel,
  extensionReviewComposerCanSubmit,
  extensionReviewCreateParams,
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
  it('renders rating, nested replies, and the comment/reply entry points in extension detail', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviews extensionId="ext-1" initialPage={page} />)

    expect(html).toContain('用户评价')
    expect(html).toContain('5.0 · 1 个评分')
    expect(html).toContain('很好用')
    expect(html).toContain('谢谢反馈')
    expect(html).toContain('>评论</button>')
    expect(html.match(/>回复<\/button>/g)).toHaveLength(2)
    expect(html).toContain('border-left:2px solid')
  })

  it('hides the top-level comment entry for the extension owner while keeping replies', () => {
    const html = renderToStaticMarkup(<ArkmeExtensionReviews
      extensionId="ext-1" canCreateTopLevelReview={false} initialPage={page}
    />)

    expect(html).not.toContain('>评论</button>')
    expect(html.match(/>回复<\/button>/g)).toHaveLength(2)
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
})
