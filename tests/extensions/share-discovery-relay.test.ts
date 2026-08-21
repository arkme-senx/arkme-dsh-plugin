import { createServer, request, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeExtensionShareDiscoveryRelay,
  DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT,
} from '../../src/extensions/share-discovery-relay.js'

const SHARE_REF = 'extshare_0123456789abcdef0123456789abcdef'
const servers: Server[] = []

async function listen(server: Server, port = 0): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return (server.address() as AddressInfo).port
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })
}

async function rawStatus(port: number, host: string): Promise<number | undefined> {
  return await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/', headers: { Host: host } }, response => {
      response.resume()
      response.once('end', () => { resolve(response.statusCode) })
    })
    req.once('error', reject)
    req.end()
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async server => { await close(server) }))
})

describe('Arkme extension share discovery relay', () => {
  it('serves a fragment-preserving redirect page without receiving the share ref', async () => {
    const portProbe = createServer()
    const discoveryPort = await listen(portProbe)
    await close(portProbe)
    const relay = new ArkmeExtensionShareDiscoveryRelay({
      actualPort: 52910,
      discoveryPort,
      logger: { info: vi.fn(), warn: vi.fn() },
    })
    await relay.start()

    const response = await fetch(`http://127.0.0.1:${discoveryPort}/#/arkme/extensions/share/${SHARE_REF}`)
    const html = await response.text()

    expect(relay.status()).toEqual({ mode: 'relay', actualPort: 52910, discoveryPort })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(html).toContain('http://127.0.0.1:52910/')
    expect(html).toContain('window.location.hash')
    expect(html).not.toContain(SHARE_REF)
    await relay.dispose()
  })

  it('refuses rebound Host headers and fails open when the discovery port is occupied', async () => {
    const blocker = createServer((_req, res) => { res.writeHead(204).end() })
    const discoveryPort = await listen(blocker)
    const logger = { info: vi.fn(), warn: vi.fn() }
    const occupied = new ArkmeExtensionShareDiscoveryRelay({ actualPort: 52910, discoveryPort, logger })

    await occupied.start()

    expect(occupied.status()).toEqual({ mode: 'unavailable', actualPort: 52910, discoveryPort })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already in use'))
    await occupied.dispose()

    await close(blocker)
    const relay = new ArkmeExtensionShareDiscoveryRelay({ actualPort: 52910, discoveryPort, logger })
    await relay.start()
    expect(await rawStatus(discoveryPort, `evil.example:${discoveryPort}`)).toBe(403)
    await relay.dispose()
  })

  it('uses the real DSH directly when it already owns the discovery port', async () => {
    const relay = new ArkmeExtensionShareDiscoveryRelay({
      actualPort: DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT,
      discoveryPort: DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT,
      logger: { info: vi.fn(), warn: vi.fn() },
    })

    await relay.start()

    expect(relay.status()).toEqual({
      mode: 'direct',
      actualPort: DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT,
      discoveryPort: DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT,
    })
    await relay.dispose()
  })
})
