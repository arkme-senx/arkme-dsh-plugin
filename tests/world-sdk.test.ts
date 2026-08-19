import { describe, expect, it } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'

function success(value: unknown): Response {
  return new Response(JSON.stringify({ ok: true, value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('World consumer SDK', () => {
  it('exposes browser-safe feed and image operations without raw URLs', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'world.feed') return success({ items: [], total: 0, hasMore: false })
        if (request.operation === 'world.image.read') {
          return success({ mediaType: 'image/png', bytes: 8, dataBase64: 'iVBORw0KGgo=' })
        }
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.worldFeed({ limit: 20, offset: 40 })).resolves.toEqual({
      items: [], total: 0, hasMore: false,
    })
    const image = await sdk.readWorldImage('arkme-world-image-v1.payload.signature')
    expect(sdk.imageDataUrl(image)).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(calls).toEqual([
      { operation: 'world.feed', params: { limit: 20, offset: 40 } },
      { operation: 'world.image.read', params: { imageRef: 'arkme-world-image-v1.payload.signature' } },
    ])
  })
})
