import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRegistryPackageMetadata } from '../src/plugin-update.js'

describe('published update metadata', () => {
  it('ships a Registry-compatible bounded notice in package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
      version: string
      arkme?: { updateNotice?: unknown }
    }

    expect(parseRegistryPackageMetadata(manifest)).toEqual({
      version: manifest.version,
      notice: {
        schemaVersion: 1,
        level: 'normal',
        title: 'Arkme 插件 0.1.6 更新',
        summary: '修复每次进入 App 的更新检查与自动升级，并解除扩展安装的对话限制。',
        publishedAt: '2026-08-19T12:57:17.000Z',
        releaseNotesUrl: 'https://www.npmjs.com/package/@senguoyun/dsh-arkme',
      },
    })
  })
})
