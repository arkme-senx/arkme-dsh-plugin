import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('published update metadata', () => {
  it('does not configure npm publication or npm-hosted plugin release notes', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
      version: string
      publishConfig?: unknown
      arkme?: { updateNotice?: { releaseNotesUrl?: string } }
    }

    expect(manifest.name).toBe('@senguoyun/dsh-arkme')
    expect(manifest.version).toBe('0.1.16')
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.arkme?.updateNotice?.releaseNotesUrl).toBe('https://arkme.ai/releases/dsh-arkme/0.1.16')
    expect(JSON.stringify(manifest)).not.toContain('registry.npmjs.org')
    expect(JSON.stringify(manifest)).not.toContain('npmjs.com')
  })
})
