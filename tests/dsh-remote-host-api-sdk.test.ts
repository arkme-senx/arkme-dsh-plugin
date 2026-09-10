import { currentDesktopSessionTool } from '../src/dsh-remote/current-session-tool.js'
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
    reportCurrentSession: vi.fn(),
    currentSession: vi.fn(async () => ({ session: { sessionRef: 'session-01', workspaceRef: 'workspace-01' } })),
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

  it('requires same-page Origin for rename and Browser selection reports', async () => {
    const host = remoteHost()
    const options = { expectedPort: 0, allowNonLoopback: false, remoteHost: () => host }
    const server = createServer(createArkmeHostApi(service, options))
    servers.push(server)
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test address')
    options.expectedPort = address.port
    const endpoint = `http://127.0.0.1:${address.port}`
    const read = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'remote.getStatus' }) })
    expect(read.status).toBe(200)
    const mutation = await fetch(endpoint, {
      method: 'POST', body: JSON.stringify({ operation: 'remote.renameDesktop', params: { displayName: 'Work Mac' } }),
    })
    expect(mutation.status).toBe(403)
    expect(await mutation.json()).toMatchObject({ ok: false, error: { code: 'origin-required' } })
    const report = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'remote.reportCurrentSession', params: {
      accountId: '42', windowRef: 'browser', revision: 1, sessionRef: 'session-01',
    } }) })
    expect(report.status).toBe(403)
    expect(host.reportCurrentSession).not.toHaveBeenCalled()
    const accepted = await fetch(endpoint, { method: 'POST', headers: { origin: endpoint }, body: JSON.stringify({ operation: 'remote.reportCurrentSession', params: {
      accountId: '42', windowRef: 'browser', revision: 1, sessionRef: 'session-01',
    } }) })
    expect(accepted.status).toBe(200)
    expect(host.reportCurrentSession).toHaveBeenCalledWith({ accountId: '42', windowRef: 'browser', revision: 1, sessionRef: 'session-01' })
  })

  it('Browser, SDK and Tool reads share the same current-session owner', async () => {
    const host = remoteHost()
    const expected = { session: { sessionRef: 'session-01', workspaceRef: 'workspace-01' } }
    await expect(dispatchArkmeHostOperation(service, 'remote.currentSession', {}, undefined, undefined, undefined, undefined, undefined, host)).resolves.toEqual(expected)
    const sdk = new ArkmeSdk({ fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      const value = await dispatchArkmeHostOperation(service, request.operation, request.params ?? {}, undefined, undefined, undefined, undefined, undefined, host)
      return new Response(JSON.stringify({ ok: true, value }))
    } })
    await expect(sdk.currentDesktopSession()).resolves.toEqual(expected)
    const tool = currentDesktopSessionTool(host)
    await expect(tool.execute({}, {} as never)).resolves.toBe(JSON.stringify(expected))
    expect(host.currentSession).toHaveBeenCalledTimes(3)
    expect(host.reportCurrentSession).not.toHaveBeenCalled()
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
