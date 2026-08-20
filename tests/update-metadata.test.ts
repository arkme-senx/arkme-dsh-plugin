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
        title: 'Arkme 插件 0.1.8 更新',
        summary: '新增桌面启动认证门禁和本地开发版本更新入口，并修复新版本策略误阻断扩展操作。',
        publishedAt: '2026-08-20T03:04:20.000Z',
        releaseNotesUrl: 'https://www.npmjs.com/package/@senguoyun/dsh-arkme',
      },
    })
  })
})
