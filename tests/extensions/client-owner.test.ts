import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeProfileExtensionOwnerConflicts, arkmeClientContentDigest,
} from '../../src/extensions/client-owner.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('extension Client single-owner identity', () => {
  it('finds an older active package by extension id even when its Client source changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-client-owner-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    const local = join(root, 'snake-local')
    mkdirSync(join(local, 'lib'), { recursive: true })
    mkdirSync(profile, { recursive: true })
    const code = 'return {\r\n  apply() { return "old" }\r\n}'
    writeFileSync(join(local, 'package.json'), JSON.stringify({ name: 'dsh-snake-draggable' }))
    writeFileSync(join(local, 'installation.json'), JSON.stringify({ extension_id: 'ext-snake' }))
    writeFileSync(join(local, 'lib', 'client.js'), [
      'window.__ModuleLoader__.load({ id: "dsh-snake-draggable", factory: (require) => {',
      `  return (function persistentClientFactory() {})(require, ${JSON.stringify({ code })})`,
      '} })',
      '',
    ].join('\n'))
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        'dsh-snake-draggable': `link:${local}`,
        '@arkme-local/ext-new': 'link:../../arkme-extensions/new',
      },
      dsh: { profile: { bundles: ['dsh-snake-draggable', '@arkme-local/ext-new'] } },
    }))

    expect(activeProfileExtensionOwnerConflicts({
      profileDirectory: profile,
      extensionId: 'ext-snake',
      contentDigest: arkmeClientContentDigest('return { apply() { return "new" } }'),
      packageName: '@arkme-local/ext-new',
    })).toEqual(['dsh-snake-draggable'])
  })

  it('does not replace a different extension merely because its Client content is identical', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-client-owner-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    const local = join(root, 'other-local')
    mkdirSync(join(local, 'arkme'), { recursive: true })
    mkdirSync(profile, { recursive: true })
    const code = 'return { apply() {} }'
    writeFileSync(join(local, 'package.json'), JSON.stringify({
      name: 'other-extension',
      dsh: { arkme: { clientContentDigest: arkmeClientContentDigest(code) } },
    }))
    writeFileSync(join(local, 'installation.json'), JSON.stringify({ extension_id: 'ext-other' }))
    writeFileSync(join(local, 'arkme', 'source.json'), JSON.stringify({
      clientCode: code,
    }))
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'other-extension': `link:${local}` },
      dsh: { profile: { bundles: ['other-extension'] } },
    }))

    expect(activeProfileExtensionOwnerConflicts({
      profileDirectory: profile,
      extensionId: 'ext-new',
      contentDigest: arkmeClientContentDigest(code),
      packageName: '@arkme-local/ext-new',
    })).toEqual([])
  })

  it('uses exact Client content only as a fallback for packages without extension identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-client-owner-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    const legacy = join(root, 'legacy')
    mkdirSync(join(legacy, 'arkme'), { recursive: true })
    mkdirSync(profile, { recursive: true })
    const code = 'return { apply() {} }'
    writeFileSync(join(legacy, 'package.json'), JSON.stringify({ name: 'legacy-extension' }))
    writeFileSync(join(legacy, 'arkme', 'source.json'), JSON.stringify({ clientCode: code }))
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'legacy-extension': `link:${legacy}` },
      dsh: { profile: { bundles: ['legacy-extension'] } },
    }))

    expect(activeProfileExtensionOwnerConflicts({
      profileDirectory: profile,
      extensionId: 'ext-new',
      contentDigest: arkmeClientContentDigest(code),
      packageName: '@arkme-local/ext-new',
    })).toEqual(['legacy-extension'])
  })
})
