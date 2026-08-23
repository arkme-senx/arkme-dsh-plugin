import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('published update metadata', () => {
  it('describes the 0.1.18 plugin release', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
      version: string
      arkme?: { updateNotice?: {
        schemaVersion?: number
        title?: string
        releaseNotesUrl?: string
      } }
    }

    expect(manifest.name).toBe('@senguoyun/dsh-arkme')
    expect(manifest.version).toBe('0.1.18')
    expect(manifest.arkme?.updateNotice).toMatchObject({
      schemaVersion: 1,
      title: 'Arkme 插件 0.1.18 更新',
      releaseNotesUrl: 'https://www.npmjs.com/package/@senguoyun/dsh-arkme',
    })
  })
})
