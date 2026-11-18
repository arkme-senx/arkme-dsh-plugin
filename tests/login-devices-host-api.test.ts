import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'
import { createArkmeHostApi } from '../src/host-api.js'

it('requires the same local page origin before dispatching device reads and writes', async () => {
  const service = { loginDevices: vi.fn(async () => ({ accountScope: 'test:1', items: [] })) }
  const options = { expectedPort: 0, allowNonLoopback: false }
  const server = createServer(createArkmeHostApi(service as never, options))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('address missing')
  options.expectedPort = address.port
  const origin = `http://127.0.0.1:${address.port}`
  try {
    for (const action of ['list', 'confirm']) {
      for (const from of [undefined, `http://localhost:${address.port}`, 'https://example.com']) {
        const r = await fetch(`${origin}/arkme-self/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(from ? { Origin: from } : {}) }, body: JSON.stringify({ operation: 'account.devices', params: { accountScope: 'test:1', action } }) })
        expect(r.status).toBe(403)
      }
    }
    expect(service.loginDevices).not.toHaveBeenCalled()
    const r = await fetch(`${origin}/arkme-self/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ operation: 'account.devices', params: { accountScope: 'test:1', action: 'list' } }) })
    expect(r.status).toBe(200)
    expect(service.loginDevices).toHaveBeenCalledExactlyOnceWith({ accountScope: 'test:1', action: 'list' }, expect.any(AbortSignal))
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close') }
})
