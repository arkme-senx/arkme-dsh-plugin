import { readFileSync } from 'node:fs'
import { satisfies } from 'semver'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/index.js'

const TARGET_DSH_VERSIONS = [
  '0.1.0-rc.8',
  '0.1.1-rc.2',
  '0.1.2-alpha.1',
] as const

describe('DSH compatibility contract', () => {
  it('does not make generation-specific Host APIs startup dependencies', () => {
    expect(inject).not.toContain('apiProxy')
    expect(inject).not.toContain('sessionController')
  })

  it('depends on the stable client sessions service instead of either generation-specific owner package', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { client: { inject: string[] } }
      peerDependencies: Record<string, string>
    }

    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-api-session-controller')
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-runtime')
  })

  it('declares every supported prerelease family for each DSH peer', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    const peers = Object.entries(manifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

    expect(peers.length).toBeGreaterThan(0)
    for (const [name, range] of peers) {
      for (const version of TARGET_DSH_VERSIONS) {
        expect(satisfies(version, range), `${name} must accept ${version}`).toBe(true)
      }
    }
  })
})
