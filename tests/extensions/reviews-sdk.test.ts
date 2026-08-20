import { describe, expect, it } from 'vitest'
import { createArkmeSdk } from '../../src/sdk/index.js'

function success(value: unknown): Response {
  return new Response(JSON.stringify({ ok: true, value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('extension reviews SDK', () => {
  it('exposes typed read/create methods without leaking Host record ids', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'extensions.reviews.list') return success({
          items: [{
            reviewRef: 'arkme-extension-review-v1.review', authorName: '小林', textContent: '很好用',
            rating: 5, createdAtMillis: 123,
          }],
          total: 1, limit: 20, offset: 0, hasMore: false,
          ratingSummary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] },
        })
        return success({
          review: {
            reviewRef: 'arkme-extension-review-v1.reply', parentReviewRef: request.params?.parentReviewRef,
            authorName: '我', textContent: request.params?.textContent, rating: 0, createdAtMillis: 124,
          },
          ratingSummary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] },
          idempotentReplay: false,
        })
      },
    })

    const page = await sdk.extensionReviews('ext-1', { limit: 20, offset: 0 })
    await sdk.createExtensionReview({
      extensionId: 'ext-1', textContent: '谢谢分享', parentReviewRef: page.items[0]!.reviewRef,
      clientMutationId: 'mutation-20260820-0001',
    })

    expect(calls).toEqual([
      { operation: 'extensions.reviews.list', params: { extensionId: 'ext-1', limit: 20, offset: 0 } },
      {
        operation: 'extensions.reviews.create',
        params: {
          extensionId: 'ext-1', textContent: '谢谢分享',
          parentReviewRef: 'arkme-extension-review-v1.review', clientMutationId: 'mutation-20260820-0001',
        },
      },
    ])
    expect(JSON.stringify(page)).not.toContain('record_uid')
  })
})
