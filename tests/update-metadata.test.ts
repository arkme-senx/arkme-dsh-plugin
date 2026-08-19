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
        title: 'Arkme 插件 0.1.5 更新',
        summary: '新增扩展市场与发布应用能力、云端 Arko 对话、群成员与群设置、相关录音读取，并优化世界交织时刻加载。',
        publishedAt: '2026-08-19T12:12:05.000Z',
        releaseNotesUrl: 'https://www.npmjs.com/package/@senguoyun/dsh-arkme',
      },
    })
  })
})
