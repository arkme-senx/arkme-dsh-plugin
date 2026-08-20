import { describe, expect, it, vi } from 'vitest'
import {
  extensionReviewCreateToolModule,
  extensionReviewsReadToolModule,
} from '../../src/tools/business/extensions/reviews.js'

describe('extension review tools', () => {
  it('reads safe review refs and creates replies through the shared owner', async () => {
    const listExtensionReviews = vi.fn(async () => ({
      items: [{
        reviewRef: 'arkme-extension-review-v1.review', authorName: '小林', textContent: '很好用',
        rating: 5, createdAtMillis: 123,
      }],
      total: 1, limit: 20, offset: 0, hasMore: false,
      ratingSummary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] as [number, number, number, number, number] },
    }))
    const createExtensionReview = vi.fn(async (input: unknown) => ({
      review: {
        reviewRef: 'arkme-extension-review-v1.reply', parentReviewRef: 'arkme-extension-review-v1.review',
        authorName: '我', textContent: '谢谢分享', rating: 0, createdAtMillis: 124,
      },
      ratingSummary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] as [number, number, number, number, number] },
      idempotentReplay: false,
      input,
    }))
    const ports = { listExtensionReviews, createExtensionReview } as never
    const read = extensionReviewsReadToolModule.create(ports)
    const create = extensionReviewCreateToolModule.create(ports)

    const readResult = await read.execute!({ extension_id: 'ext-1', limit: 20 }, { callId: 'call-read', signal: new AbortController().signal } as never)
    expect(String(readResult)).toContain('arkme-extension-review-v1.review')
    await create.execute!({
      extension_id: 'ext-1', text_content: '谢谢分享', parent_review_ref: 'arkme-extension-review-v1.review',
    }, { callId: 'call-create', signal: new AbortController().signal } as never)
    expect(createExtensionReview).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', textContent: '谢谢分享', parentReviewRef: 'arkme-extension-review-v1.review',
      clientMutationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }), expect.any(AbortSignal))
  })
})
