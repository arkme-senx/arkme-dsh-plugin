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
        title: 'Arkme 插件 0.1.10 更新',
        summary: '基于最新 master 重新发布，包含当前扩展市场、Agent 预览图上传及新版 DSH 兼容修复。',
        publishedAt: '2026-08-20T14:25:34.000Z',
        releaseNotesUrl: 'https://www.npmjs.com/package/@senguoyun/dsh-arkme',
      },
    })
  })
})
