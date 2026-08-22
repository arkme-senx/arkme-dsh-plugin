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
        if (request.operation === 'world.mine') return success({ items: [], total: 0, hasMore: false })
        if (request.operation === 'world.user') return success({ items: [], total: 0, hasMore: false })
        if (request.operation === 'world.voiceprint.availability') return success({
          items: [{ recordRef: 'record-ref', playable: true }],
        })
        if (request.operation === 'world.voiceprint.playback.generate') return success({
          mediaRef: 'media-ref', mimeType: 'audio/wav', durationMillis: 1000, cacheHit: false,
          chunkIndex: 0, chunkCount: 1, chunkStartRune: 0, chunkEndRune: 4,
        })
        if (request.operation === 'world.voiceprint.invite') return success({
          sent: true, peerDisplayName: '小林', messageItemUid: 'message-1', expiresAtMillis: 1_900_000_000_000,
        })
        if (request.operation === 'world.interactions.list') return success({ items: [], total: 0, hasMore: false })
        if (request.operation === 'world.interactions.create-text') {
          return success({ interaction: { interactionRef: 'interaction-ref', parentRef: 'record-ref' } })
        }
        if (request.operation === 'world.image.read') {
          return success({ mediaType: 'image/png', bytes: 8, dataBase64: 'iVBORw0KGgo=' })
        }
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.worldFeed({ limit: 20, offset: 40 })).resolves.toEqual({
      items: [], total: 0, hasMore: false,
    })
    await expect(sdk.myWorldFeed({ limit: 10, offset: 20 })).resolves.toEqual({
      items: [], total: 0, hasMore: false,
    })
    await expect(sdk.userWorldFeed(7, { limit: 20, offset: 0 })).resolves.toEqual({
      items: [], total: 0, hasMore: false,
    })
    await expect(sdk.userWorldFeed(0)).rejects.toThrow('positive integer')
    await expect(sdk.worldVoiceprintPlaybackAvailability(['record-ref'])).resolves.toEqual({
      items: [{ recordRef: 'record-ref', playable: true }],
    })
    await expect(sdk.generateWorldVoiceprintPlayback({
      recordRef: 'record-ref', chunkIndex: 0,
    })).resolves.toMatchObject({ mediaRef: 'media-ref', chunkCount: 1 })
    await expect(sdk.inviteWorldVoiceprint('record-ref')).resolves.toMatchObject({
      sent: true, peerDisplayName: '小林',
    })
    await expect(sdk.worldInteractions('record-ref', { limit: 50, offset: 10 })).resolves.toEqual({
      items: [], total: 0, hasMore: false,
    })
    await expect(sdk.createWorldTextInteraction({
      targetRef: 'record-ref', textContent: '评论', clientMutationId: 'mutation-20260819-0001',
    })).resolves.toMatchObject({ interaction: { interactionRef: 'interaction-ref' } })
    const image = await sdk.readWorldImage('arkme-world-image-v1.payload.signature')
    expect(sdk.imageDataUrl(image)).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(calls).toEqual([
      { operation: 'world.feed', params: { limit: 20, offset: 40 } },
      { operation: 'world.mine', params: { limit: 10, offset: 20 } },
      { operation: 'world.user', params: { userId: 7, limit: 20, offset: 0 } },
      { operation: 'world.voiceprint.availability', params: { recordRefs: ['record-ref'] } },
      {
        operation: 'world.voiceprint.playback.generate',
        params: { recordRef: 'record-ref', chunkIndex: 0 },
      },
      { operation: 'world.voiceprint.invite', params: { recordRef: 'record-ref' } },
      { operation: 'world.interactions.list', params: { recordRef: 'record-ref', limit: 50, offset: 10 } },
      {
        operation: 'world.interactions.create-text',
        params: { targetRef: 'record-ref', textContent: '评论', clientMutationId: 'mutation-20260819-0001' },
      },
      { operation: 'world.image.read', params: { imageRef: 'arkme-world-image-v1.payload.signature' } },
    ])
  })
})
