import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretValue } from '../src/secret-value.js'
import { createOpenClawFileSecretStore } from '../src/openclaw/index.js'

describe('OpenClaw file SecretRef store', () => {
  it('refuses to adopt an existing resource without its owner marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-openclaw-owner-'))
    const store = createOpenClawFileSecretStore({ rootDir: root })
    await expect(store.ensureOwnership({ resourceHash: '0123456789abcdef', localResourceExists: true }))
      .rejects.toThrow('without an Arkme owner marker')
  })

  it('persists only into a private file and returns a non-secret reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-openclaw-secret-'))
    const store = createOpenClawFileSecretStore({ rootDir: root })
    await store.ensureOwnership({ resourceHash: '0123456789abcdef', localResourceExists: false })
    const ref = await store.persist({ resourceHash: '0123456789abcdef', secret: new SecretValue('private-token') })

    expect(ref).toEqual({
      provider: 'arkme-bot-0123456789abcdef',
      source: 'file',
      id: 'value',
      providerPath: join(root, '0123456789abcdef.secret'),
    })
    expect(JSON.stringify(ref)).not.toContain('private-token')
    await expect(readFile(ref.providerPath, 'utf8')).resolves.toBe('private-token')
    expect((await stat(ref.providerPath)).mode & 0o777).toBe(0o600)
  })
})
