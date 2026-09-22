import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'

const success = (value: unknown) => new Response(JSON.stringify({ ok: true, value }), { headers: { 'Content-Type': 'application/json' } })

it('discovers archive support and uses the same three Host operations without exposing owner IDs', async () => {
  const calls: unknown[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body)
    if (body.operation === 'provider.capabilities') return success({ contractVersion: 1, features: { entityArchive: true } })
    return success({ effectiveArchived: true, selfArchived: false })
  } })
  await sdk.listArchives('cursor')
  await sdk.getArchiveStates(['opaque'])
  await expect(sdk.setArchiveState({ sourceRef: 'opaque', selfArchived: false, expectedRevision: 4 })).resolves.toMatchObject({ selfArchived: false, effectiveArchived: true })
  expect(calls).toContainEqual({ operation: 'archives.list', params: { cursor: 'cursor' } })
  expect(calls).toContainEqual({ operation: 'archives.state', params: { sourceRefs: ['opaque'] } })
  expect(calls).toContainEqual({ operation: 'archives.set', params: { sourceRef: 'opaque', selfArchived: false, expectedRevision: 4 } })
  await expect(sdk.setArchiveState({ sourceRef: 'opaque', selfArchived: true, expectedRevision: -1 })).rejects.toThrow()
})

it('fails explicitly on unsupported Hosts and propagates cancellation', async () => {
  const fetchImpl = vi.fn(async () => success({ contractVersion: 1, features: {} }))
  const sdk = createArkmeSdk({ fetchImpl })
  await expect(sdk.listArchives()).rejects.toThrow()
  expect(fetchImpl).toHaveBeenCalledOnce()
  const controller = new AbortController(); controller.abort()
  await expect(sdk.getArchiveStates(['opaque'], controller.signal)).rejects.toThrow()
})
