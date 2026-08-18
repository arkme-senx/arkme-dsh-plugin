import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { arkmeToolCatalog } from '../src/tools/index.js'

const root = new URL('..', import.meta.url).pathname

function textFiles(path: string): string[] {
  return readdirSync(path).flatMap(name => {
    const child = join(path, name)
    if (statSync(child).isDirectory()) return textFiles(child)
    return /\.(?:md|ts|tsx|json|yml)$/.test(name) ? [child] : []
  })
}

function withoutInfrastructureNames(content: string): string {
  return content
    .replaceAll('https://jotmo.senguo.me', '')
    .replaceAll('https://jotmo-record.senguo.me', '')
    .replaceAll('https://jotmo-chat.senguo.me', '')
    .replaceAll('https://jotmo-im.senguo.me', '')
    .replaceAll('https://jotmo-world.senguo.me', '')
    .replaceAll('https://jotmo-relation.senguo.me', '')
    .replaceAll('https://api.jotmo.cc', '')
    .replaceAll('https://record.jotmo.cc', '')
    .replaceAll('https://chat.jotmo.cc', '')
    .replaceAll('https://im.jotmo.cc', '')
    .replaceAll('https://world.jotmo.cc', '')
    .replaceAll('https://relation.jotmo.cc', '')
    .replaceAll('jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', '')
    .replaceAll('jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', '')
    .replaceAll('jotmo-userfiles.senguo.me', '')
    .replaceAll('userfiles.jotmo.cc', '')
    .replaceAll('recipient_jotmo_id', '')
    .replaceAll("'jotmo-userfiles-test'", '')
    .replaceAll("'jotmo-userfiles'", '')
    .replaceAll('dsh-worktrees/jotmo-virtual-workspace', '')
}

function withoutRecipientIdCompatibilityAliases(file: string, content: string): string {
  const allowedFiles = new Set([
    join(root, 'src/tools/business/conversation/send-direct-text.ts'),
    join(root, 'src/tools/prompts/business.ts'),
  ])
  if (!allowedFiles.has(file)) return content
  return content
    .replaceAll('即我号', '')
    .replaceAll('即我id', '')
}

describe('Arkme plugin identity', () => {
  it('removes legacy product identity outside unchanged service infrastructure', () => {
    const files = [
      join(root, 'README.md'),
      join(root, 'cordis.patch.yml'),
      join(root, 'package.json'),
      join(root, 'tsdown.config.ts'),
      ...textFiles(join(root, 'docs')),
      ...textFiles(join(root, 'src')),
    ]
    const residuals = files.flatMap(file => {
      const source = withoutRecipientIdCompatibilityAliases(file, readFileSync(file, 'utf8'))
      const content = withoutInfrastructureNames(source)
      return /jotmo|jiwo|即我/i.test(content) ? [file.slice(root.length)] : []
    })

    expect(residuals).toEqual([])
  })

  it('declares the Arkme package, route, provider and tool surface', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string }
    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

    expect(manifest.name).toBe('@senguoyun/dsh-arkme')
    expect(patch).toContain("name: '@senguoyun/dsh-arkme'")
    expect(patch).toContain('routePath: /arkme-self/api')
    expect(arkmeToolCatalog.toolNamesFor('business')).toEqual(expect.arrayContaining([
      'arkme_sources_list', 'arkme_source_read', 'arkme_text_send',
    ]))
  })

  it('embeds the complete official Arkme application icon', () => {
    const source = readFileSync(join(root, 'src/client/arkme-assets.ts'), 'utf8')
    const encoded = source.match(/base64,([^']+)'/)?.[1]

    expect(encoded).toBeDefined()
    const image = Buffer.from(encoded ?? '', 'base64')
    expect(image).toHaveLength(6_597)
    expect(createHash('sha256').update(image).digest('hex'))
      .toBe('7c23a11cfe237a7ab09259453ecbf982099f53f1d0df2a187e26daa92d20d664')
  })
})
