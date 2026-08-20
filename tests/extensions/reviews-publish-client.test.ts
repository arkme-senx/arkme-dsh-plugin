import { describe, expect, it, vi } from 'vitest'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'

describe('extension review registry client', () => {
  it('uses the public list and authenticated create contracts', async () => {
    const post = vi.fn(async <T>(requestPath: string, body: Record<string, unknown>): Promise<T> => {
      if (requestPath.endsWith('/list')) return {
        items: [], total: 0, limit: 20, offset: 0, has_more: false,
        rating_summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] },
      } as T
      return {
        review: { extension_id: 'ext-1', review_id: 'rvw_1', user_id: 1, text_content: body.text_content, rating: 5, created_at: 1 },
        rating_summary: { average: 5, count: 1, histogram: [0, 0, 0, 0, 1] }, idempotent_replay: false,
      } as T
    })
    const client = new ExtensionPublishClient(post)

    await client.listReviews('ext-1', { limit: 20, offset: 0 })
    await client.createReview({
      extensionId: 'ext-1', recordUid: '11111111-1111-4111-8111-111111111111',
      textContent: '很好用', rating: 5, clientMutationId: 'mutation-0001',
    })

    expect(post).toHaveBeenNthCalledWith(1, '/api/public/v1/extensions/reviews/list', {
      extension_id: 'ext-1', limit: 20, offset: 0,
    }, undefined)
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/extensions/reviews/create', {
      extension_id: 'ext-1', record_uid: '11111111-1111-4111-8111-111111111111',
      text_content: '很好用', rating: 5, client_mutation_id: 'mutation-0001',
    }, undefined)
  })
})
