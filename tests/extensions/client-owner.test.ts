import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeProfileClientOwnerConflicts, arkmeClientOwnerKey,
} from '../../src/extensions/client-owner.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('extension Client single-owner identity', () => {
  it('finds an active older local package with the same normalized Client source', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-client-owner-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    const local = join(root, 'snake-local')
    mkdirSync(join(local, 'lib'), { recursive: true })
    mkdirSync(profile, { recursive: true })
    const code = 'return {\r\n  apply() {}\r\n}'
    writeFileSync(join(local, 'package.json'), JSON.stringify({ name: 'dsh-snake-draggable' }))
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

    expect(activeProfileClientOwnerConflicts({
      profileDirectory: profile,
      ownerKey: arkmeClientOwnerKey(code.replace(/\r\n/g, '\n')),
      packageName: '@arkme-local/ext-new',
      managedPackageNames: new Set(['@arkme-local/ext-new']),
    })).toEqual(['dsh-snake-draggable'])
  })

  it('does not replace a different Client merely because it uses the same slot family', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-client-owner-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    const local = join(root, 'other-local')
    mkdirSync(join(local, 'arkme'), { recursive: true })
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(local, 'package.json'), JSON.stringify({ name: 'other-extension' }))
    writeFileSync(join(local, 'arkme', 'source.json'), JSON.stringify({
      clientCode: 'return { apply(ctx) { ctx.slots.register({ name: "shell.overlay", id: "same" }, () => null) } }',
    }))
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'other-extension': `link:${local}` },
      dsh: { profile: { bundles: ['other-extension'] } },
    }))

    expect(activeProfileClientOwnerConflicts({
      profileDirectory: profile,
      ownerKey: arkmeClientOwnerKey('return { apply() {} }'),
      packageName: '@arkme-local/ext-new',
    })).toEqual([])
  })
})
