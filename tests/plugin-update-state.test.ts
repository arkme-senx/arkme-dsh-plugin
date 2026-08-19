import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PluginUpdateStateStore } from '../src/plugin-update-state.js'

describe('PluginUpdateStateStore', () => {
  it('persists update facts atomically with private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-update-state-'))
    const store = new PluginUpdateStateStore(root)
    await store.update(state => {
      state.lastCheckedAtMillis = 100
      state.lastSuccessfulCheckAtMillis = 100
      state.lastKnownLatestVersion = '0.1.4'
      state.lastKnownNotice = { schemaVersion: 1, level: 'important', title: '新版本' }
      state.consecutiveFailures = 0
    })

    const reloaded = new PluginUpdateStateStore(root)
    await expect(reloaded.snapshot()).resolves.toMatchObject({
      version: 1,
      lastKnownLatestVersion: '0.1.4',
      lastKnownNotice: { level: 'important', title: '新版本' },
    })
    const path = join(root, 'plugin-update-state.json')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    expect(await readFile(path, 'utf8')).not.toContain('accessToken')
  })

  it('recovers malformed or untrusted state without preserving unsafe fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-update-state-'))
    const path = join(root, 'plugin-update-state.json')
    await chmod(root, 0o700)
    await writeFile(path, '{not-json', { mode: 0o600 })
    const onRecover = vi.fn()
    const store = new PluginUpdateStateStore(root, { onRecover })

    await expect(store.snapshot()).resolves.toEqual({ version: 1, consecutiveFailures: 0 })
    expect(onRecover).toHaveBeenCalledOnce()

    await writeFile(path, JSON.stringify({
      version: 1,
      lastKnownLatestVersion: '0.1.4',
      lastKnownNotice: {
        schemaVersion: 1,
        level: 'critical',
        title: 'x'.repeat(1000),
        releaseNotesUrl: 'javascript:alert(1)',
      },
      consecutiveFailures: 9999,
      accessToken: 'secret',
    }), { mode: 0o600 })
    const normalized = await new PluginUpdateStateStore(root).snapshot()
    expect(normalized.consecutiveFailures).toBe(100)
    expect(normalized.lastKnownNotice).toEqual({
      schemaVersion: 1,
      level: 'critical',
    })
    expect(normalized).not.toHaveProperty('accessToken')
  })
})
