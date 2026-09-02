import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { HttpManagedOpenApiControlPlane, OpenApiControlPlaneError } from '../src/openapi-mcp/control-plane.js'
import { SecretValue } from '../src/secret-value.js'

const keyId = '0123456789abcdef01234567'
const apiKey = `arkme_${keyId}_${'A'.repeat(43)}`
const keyDigest = createHash('sha256').update(apiKey, 'utf8').digest('hex')

function success(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, message: '请求成功', data }), { status: 200 })
}

describe('managed OpenAPI control plane', () => {
  it('uses the Access credential only in Authorization and validates issued responses', async () => {
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = []
    const client = new HttpManagedOpenApiControlPlane('https://openapi.example.com/', vi.fn(async (input, init) => {
      requests.push({
        url: String(input), authorization: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body)),
      })
      return success({
        state: 'issued', key_id: keyId, generation: 3, api_key: apiKey, expires_at: 1_800_000_000_000,
        reconcile_after_seconds: 21_600,
      })
    }), 5_000)

    await expect(client.ensure(
      new SecretValue('access-secret'), { keyId, generation: 2, keyDigest }, new AbortController().signal,
    )).resolves.toMatchObject({
      state: 'issued', keyId, generation: 3, apiKey,
    })
    expect(requests).toEqual([{
      url: 'https://openapi.example.com/api/v1/platform/api-key/managed/ensure',
      authorization: 'Bearer access-secret', body: {
        observed_key_id: keyId, observed_generation: 2, observed_key_digest: keyDigest,
      },
    }])
  })

  it('rejects plaintext on ready and separates authorization failure', async () => {
    const invalid = new HttpManagedOpenApiControlPlane('https://openapi.example.com', vi.fn(async () => success({
      state: 'ready', key_id: keyId, generation: 1, api_key: apiKey, expires_at: 1_800_000_000_000,
      reconcile_after_seconds: 21_600,
    })), 5_000)
    await expect(invalid.ensure(new SecretValue('access'), { keyId, generation: 1, keyDigest }, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'contract' })

    const unauthorized = new HttpManagedOpenApiControlPlane(
      'https://openapi.example.com', vi.fn(async () => new Response('', { status: 401 })), 5_000,
    )
    await expect(unauthorized.ensure(new SecretValue('access'), { keyId, generation: 1, keyDigest }, new AbortController().signal))
      .rejects.toBeInstanceOf(OpenApiControlPlaneError)
    await expect(unauthorized.ensure(new SecretValue('access'), { keyId, generation: 1, keyDigest }, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('rejects incomplete or malformed local credential observations before transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const client = new HttpManagedOpenApiControlPlane('https://openapi.example.com', fetchImpl, 5_000)

    await expect(client.ensure(
      new SecretValue('access'), { keyId, generation: 1, keyDigest: 'not-a-digest' }, new AbortController().signal,
    )).rejects.toMatchObject({ kind: 'contract' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the managed API Key itself to disconnect without identity fields', async () => {
    let request: { authorization: string | null; body: unknown } | undefined
    const client = new HttpManagedOpenApiControlPlane('https://openapi.example.com', vi.fn(async (_input, init) => {
      request = {
        authorization: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body)),
      }
      return success({ state: 'disconnected' })
    }), 5_000)

    await expect(client.disconnect(new SecretValue(apiKey), new AbortController().signal)).resolves.toBeUndefined()
    expect(request).toEqual({ authorization: `Bearer ${apiKey}`, body: {} })
  })

  it('rejects unknown lifecycle states', async () => {
    const client = new HttpManagedOpenApiControlPlane('https://openapi.example.com', vi.fn(async () => success({
      state: 'unknown', reconcile_after_seconds: 21_600,
    })), 5_000)

    await expect(client.ensure(new SecretValue('access'), undefined, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'contract' })
  })

  it('stops reading control responses beyond the fixed byte limit', async () => {
    const client = new HttpManagedOpenApiControlPlane(
      'https://openapi.example.com',
      vi.fn(async () => new Response('x'.repeat(64 * 1024 + 1), { status: 200 })),
      5_000,
    )
    await expect(client.ensure(new SecretValue('access'), undefined, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'contract' })
  })
})
