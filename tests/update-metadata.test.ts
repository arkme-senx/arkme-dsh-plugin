import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('published update metadata', () => {
  it('keeps the current release metadata unchanged while update transport moves off npm', () => {
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
    expect(manifest.version).toBe('0.1.15')
    expect(manifest.arkme?.updateNotice).toMatchObject({
      schemaVersion: 1,
      title: 'Arkme 插件 0.1.15 更新',
      releaseNotesUrl: 'https://www.npmjs.com/package/@senguoyun/dsh-arkme',
    })
  })
})
