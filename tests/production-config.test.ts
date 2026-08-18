import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('production plugin configuration', () => {
  it('routes each owner API to its production service', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(patch).toContain('environment: prod')
    expect(patch).toContain('authBaseUrl: https://api.jotmo.cc')
    expect(patch).toContain('recordBaseUrl: https://record.jotmo.cc')
    expect(patch).toContain('chatBaseUrl: https://chat.jotmo.cc')
    expect(patch).toContain('imBaseUrl: https://im.jotmo.cc')
    expect(patch).toContain('worldBaseUrl: https://world.jotmo.cc')
    expect(patch).toContain('relationBaseUrl: https://relation.jotmo.cc')
    expect(patch).toContain('intelligentBaseUrl: https://intelligent.jotmo.cc')
    expect(patch).toContain('toolProfile: business')
    expect(patch).toContain('allowProduction: true')
    expect(patch).not.toContain('chatBaseUrl: https://im.jotmo.cc')
  })
})
