import { describe, expect, it, vi } from 'vitest'

import { HttpOpenApiCapabilityGateway } from '../src/openapi-capability-gateway.js'
import {
  ManagedOpenApiCredentialUnavailableError,
  ManagedOpenApiCredentialSupersededError,
  type ManagedOpenApiCredentialExecutor,
} from '../src/openapi-mcp/types.js'
import { SecretValue } from '../src/secret-value.js'

function executor(apiKey = 'managed-secret-key'): ManagedOpenApiCredentialExecutor {
  return {
    executeWithCredential: async (_callerSignal, execute) => await execute(
      new SecretValue(apiKey),
      new AbortController().signal,
    ),
  }
}

describe('HttpOpenApiCapabilityGateway', () => {
  it('leases the managed credential only inside the fixed same-origin request', async () => {
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => new Response(JSON.stringify({
      code: 200,
      data: { items: [], total_count: 0, has_more: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    const gateway = new HttpOpenApiCapabilityGateway('https://openapi.example.test', executor(), fetchImpl)

    const result = await gateway.list({ limit: 20 }, new AbortController().signal)

    expect(result).toEqual({ items: [], total_count: 0, has_more: false })
    expect(fetchImpl).toHaveBeenCalledWith(new URL('https://openapi.example.test/api/v1/teams/list'), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer managed-secret-key' }),
      cache: 'no-store',
      redirect: 'error',
    }))
    expect(JSON.stringify(result)).not.toContain('managed-secret-key')
  })

  it('signals credential rejection to the single managed lifecycle owner', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const gateway = new HttpOpenApiCapabilityGateway(
      'https://openapi.example.test',
      executor(),
      vi.fn(async () => new Response(body, { status: 401 })) as typeof fetch,
    )
    await expect(gateway.list({ limit: 20 }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'unavailable', retryable: true })
    expect(cancelled).toBe(true)
  })

  it.each([
    { error: new ManagedOpenApiCredentialUnavailableError(), code: 'login-required' },
    { error: new ManagedOpenApiCredentialSupersededError(), code: 'account-changed' },
  ])('normalizes managed lifecycle failures at the transport boundary', async ({ error, code }) => {
    const credentials: ManagedOpenApiCredentialExecutor = {
      executeWithCredential: async () => { throw error },
    }
    const gateway = new HttpOpenApiCapabilityGateway('https://openapi.example.test', credentials)

    await expect(gateway.list({ limit: 20 }, new AbortController().signal))
      .rejects.toMatchObject({ code, retryable: true })
  })

  it.each([
    { status: 403, retryable: false },
    { status: 408, retryable: true },
    { status: 425, retryable: true },
    { status: 429, retryable: true },
    { status: 503, retryable: true },
  ])('classifies HTTP $status retryability without inventing another auth state', async ({ status, retryable }) => {
    const gateway = new HttpOpenApiCapabilityGateway(
      'https://openapi.example.test',
      executor(),
      vi.fn(async () => new Response(JSON.stringify({ code: status }), { status })) as typeof fetch,
    )

    await expect(gateway.list({ limit: 20 }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'unavailable', retryable })
  })

  it('rejects base URLs with paths so capabilities cannot escape the configured origin contract', () => {
    expect(() => new HttpOpenApiCapabilityGateway('https://openapi.example.test/private', executor()))
      .toThrow('must be an HTTP origin')
  })

  it('cancels and rejects an oversized response before buffering it without bound', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(40 * 1024)) },
      cancel() { cancelled = true },
    })
    const gateway = new HttpOpenApiCapabilityGateway(
      'https://openapi.example.test',
      executor(),
      vi.fn(async () => new Response(body, { status: 200 })) as typeof fetch,
    )

    await expect(gateway.list({ limit: 20 }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'invalid-response' })
    expect(cancelled).toBe(true)
  })
})
