import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import type { DshRemoteHostFacade, DshRemoteStatus } from '../src/dsh-remote/types.js'

const status: DshRemoteStatus = {
  contractVersion: 1, available: true, enabled: true, connected: true,
  accountId: '42', desktopRef: 'desktop-01', runtimeRef: 'runtime-01',
  hostGeneration: 3, capabilities: ['session.list'], revision: 1,
}

function remoteHost(): DshRemoteHostFacade {
  return {
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    getStatus: vi.fn(() => status), renameDesktop: vi.fn(async () => status),
    subscribe: vi.fn(() => () => undefined),
  }
}

const service = {} as Parameters<typeof dispatchArkmeHostOperation>[0]
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close()
    await once(server, 'close')
  }
})

describe('login-only DSH remote Host API and SDK', () => {
  it('exposes status and desktop rename but no pairing/authorization operations', async () => {
    const host = remoteHost()
    await expect(dispatchArkmeHostOperation(service, 'remote.getStatus', {}, undefined, undefined, undefined, undefined, undefined, host))
      .resolves.toEqual(status)
    await expect(dispatchArkmeHostOperation(service, 'remote.renameDesktop', { displayName: 'Work Mac' }, undefined, undefined, undefined, undefined, undefined, host))
      .resolves.toEqual(status)
    expect(host.renameDesktop).toHaveBeenCalledWith('Work Mac')
    await expect(dispatchArkmeHostOperation(service, 'remote.createPairingAttempt' as never, {}, undefined, undefined, undefined, undefined, undefined, host))
      .rejects.toMatchObject({ code: 'operation-unknown', httpStatus: 404 })
  })

  it('requires same-page Origin only for the remaining rename mutation', async () => {
    const host = remoteHost()
    const server = createServer(createArkmeHostApi(service, {
      expectedPort: 0, allowNonLoopback: false, remoteHost: () => host,
    }))
    servers.push(server)
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test address')
    const endpoint = `http://127.0.0.1:${address.port}`
    const read = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'remote.getStatus' }) })
    expect(read.status).toBe(200)
    const mutation = await fetch(endpoint, {
      method: 'POST', body: JSON.stringify({ operation: 'remote.renameDesktop', params: { displayName: 'Work Mac' } }),
    })
    expect(mutation.status).toBe(403)
    expect(await mutation.json()).toMatchObject({ ok: false, error: { code: 'origin-required' } })
  })

  it('maps the typed SDK to only the remaining remote operations', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sdk = new ArkmeSdk({
      route: '/arkme-self/api',
      fetchImpl: vi.fn(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>
        requests.push(request)
        return new Response(JSON.stringify({ ok: true, value: status }), { status: 200 })
      }),
    })
    await sdk.remoteStatus()
    await sdk.renameRemoteDesktop(' Work Mac ')
    expect(requests).toEqual([
      { operation: 'remote.getStatus' },
      { operation: 'remote.renameDesktop', params: { displayName: 'Work Mac' } },
    ])
    await expect(sdk.renameRemoteDesktop('  ')).rejects.toThrow(/1 to 80/)
  })
})
