import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { arkmeToolCatalog } from '../src/tools/index.js'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('Arkme plugin identity', () => {
  it('declares the Arkme package, route, provider and tool surface', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string }
    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

    expect(manifest.name).toBe('@senguoyun/dsh-arkme')
    expect(patch).toContain("name: '@senguoyun/dsh-arkme'")
    expect(patch).toContain('routePath: /arkme-self/api')
    expect(arkmeToolCatalog.toolNamesFor('business')).toEqual(expect.arrayContaining([
      'arkme_user_profile', 'arkme_id_set', 'arkme_sources_list', 'arkme_source_read', 'arkme_text_send',
    ]))
  })

  it('embeds the transparent Arkme application mark', () => {
    const source = readFileSync(join(root, 'src/client/arkme-assets.ts'), 'utf8')
    const encoded = source.match(/base64,([^']+)'/)?.[1]

    expect(encoded).toBeDefined()
    const image = Buffer.from(encoded ?? '', 'base64')
    expect(image).toHaveLength(18_781)
    expect(createHash('sha256').update(image).digest('hex'))
      .toBe('a5cb368d40afb15ca3b59259a2abb30a2f98defdacbd2cecdaf663d549ef44da')
  })
})
