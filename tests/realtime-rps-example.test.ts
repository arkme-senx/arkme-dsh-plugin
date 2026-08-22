import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packArkmeExtension, unpackArkmeExtension } from '../src/extensions/artifact.js'

const exampleRoot = new URL('../examples/realtime-rock-paper-scissors/', import.meta.url)

function readExample(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, exampleRoot)), 'utf8')
}

describe('realtime rock-paper-scissors example', () => {
  it('stays syntactically valid and packages as a Host+Client realtime extension', () => {
    const manifest = JSON.parse(readExample('manifest.json')) as {
      name: string
      description: string
      version: string
      runtime: { dsh: string; arkme_provider_contract: number }
      permissions: string[]
      halves: { host: boolean; client: boolean }
    }
    const hostCode = readExample('host.js')
    const clientCode = readExample('client.js')
    expect(() => new Function('defineTool', 'harness', hostCode)).not.toThrow()
    expect(() => new Function('React', 'styles', 'host', 'harness', clientCode)).not.toThrow()

    const artifact = packArkmeExtension({
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      dshRange: manifest.runtime.dsh,
      arkmeProviderContract: manifest.runtime.arkme_provider_contract,
      permissions: manifest.permissions,
      hostCode,
      clientCode,
    })
    const unpacked = unpackArkmeExtension(artifact.bytes)
    expect(unpacked.manifest.permissions).toEqual(['realtime'])
    expect(unpacked.manifest.halves).toEqual({ host: true, client: true })
    expect(unpacked.hostCode).toContain("harness.handle('realtime.open'")
    expect(unpacked.hostCode).toContain('event.senderSeatRef')
    expect(unpacked.hostCode).not.toContain('event.senderClientRef')
    expect(unpacked.clientCode).toContain('harness.realtime.onOpen')
  })
})
