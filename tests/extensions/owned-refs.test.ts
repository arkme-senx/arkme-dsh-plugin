import { describe, expect, it } from 'vitest'
import { ArkmeOwnedExtensionRefs } from '../../src/extensions/owned-refs.js'

describe('owned extension opaque references', () => {
  it('hides runtime identities and rejects cross-account or expired use', () => {
    let now = 1_000
    const refs = new ArkmeOwnedExtensionRefs({ ttlMillis: 60_000, maxEntries: 10, now: () => now })
    const ref = refs.issue(7, {
      kind: 'cordis', sourceKey: 'instance\0session\0plugin', agentId: 'session', pluginId: 'plugin', packageId: 'package',
    })

    expect(ref).toMatch(/^owned_[a-f0-9-]+$/)
    expect(ref).not.toContain('session')
    expect(refs.resolve(7, ref)).toMatchObject({ kind: 'cordis', packageId: 'package' })
    expect(() => refs.resolve(8, ref)).toThrow('引用不属于当前账号')
    now += 60_001
    expect(() => refs.resolve(7, ref)).toThrow('引用已过期')
  })

  it('invalidates every short-lived source reference for the account after deletion', () => {
    const refs = new ArkmeOwnedExtensionRefs()
    const deleted = refs.issue(7, {
      kind: 'cordis', sourceKey: 'instance\0session\0plugin', agentId: 'session', pluginId: 'plugin', packageId: 'package',
    })
    const retained = refs.issue(8, {
      kind: 'cordis', sourceKey: 'instance\0other\0plugin', agentId: 'other', pluginId: 'plugin', packageId: 'package',
    })

    refs.clearUser(7)

    expect(() => refs.resolve(7, deleted)).toThrow('引用不存在或已失效')
    expect(refs.resolve(8, retained)).toMatchObject({ agentId: 'other' })
  })
})
