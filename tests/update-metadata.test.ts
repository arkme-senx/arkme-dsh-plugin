import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('published update metadata', () => {
  it('keeps packaged release metadata aligned with the manifest version', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
      version: string
      arkme?: { updateNotice?: {
        schemaVersion?: number
        title?: string
        summary?: string
        releaseNotesUrl?: string
      } }
    }

    expect(manifest.name).toBe('@senguoyun/dsh-arkme')
    expect(manifest.version).toBe('0.1.22')
    expect(manifest.arkme?.updateNotice).toMatchObject({
      schemaVersion: 1,
      title: `Arkme 插件 ${manifest.version} 更新`,
    })
    expect(manifest.arkme?.updateNotice?.summary?.trim()).not.toBe('')
    expect(manifest.arkme?.updateNotice?.releaseNotesUrl).toMatch(/^https:\/\//)
  })
})
