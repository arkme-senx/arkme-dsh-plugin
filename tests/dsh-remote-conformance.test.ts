import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dsh-remote')

describe('DSH Remote account-login golden fixtures', () => {
  it('keeps every contract fixture pinned by checksum', async () => {
    const manifest = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8')) as {
      authority: string
      files: Record<string, string>
    }
    expect(manifest.authority).toBe('authenticated-account')
    for (const [name, checksum] of Object.entries(manifest.files)) {
      const value = await readFile(join(fixtureDirectory, name))
      expect(createHash('sha256').update(value).digest('hex'), name).toBe(checksum)
    }
  })

  it('contains the subscribe-before-register and exact positive-lease targets only', async () => {
    const fixture = JSON.parse(await readFile(join(fixtureDirectory, 'protocol-v1.json'), 'utf8')) as Record<string, any>
    expect(fixture.host_pre_registration_subscribe).toMatchObject({
      channel_ref: fixture.runtime_target.runtime_ref,
      runtime_ref: fixture.runtime_target.runtime_ref,
      host_lease_generation: 0,
    })
    expect(fixture.controller_publish).toMatchObject({
      channel_ref: fixture.runtime_target.runtime_ref,
      runtime_ref: fixture.runtime_target.runtime_ref,
      host_lease_generation: fixture.runtime_target.host_lease_generation,
      direction: 'request',
    })
    const encoded = JSON.stringify(fixture)
    expect(encoded).not.toMatch(/pairing|binding|credential|grant|authorization_ref|remote_auth_epoch/)
  })
})
