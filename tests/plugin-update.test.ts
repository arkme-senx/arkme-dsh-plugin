import { readFileSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmePluginUpdateManager,
  readInstalledPluginVersion,
  validatePluginUpdateServiceOrigin,
} from '../src/plugin-update.js'
import { PluginUpdateInstallStateStore } from '../src/plugin-update-install-state.js'
const artifactUrl = 'https://releases.jotmo.test/arkme-releases/plugin/0.1.4/dsh-arkme-0.1.4.tgz'

function updateResponse(version = '0.1.4'): Response {
  const payload = {
    version,
    releaseNotes: '自有服务器分发的插件更新',
    downloadUrl: version === '0.1.4'
      ? artifactUrl
      : `https://releases.jotmo.test/arkme-releases/plugin/${version}/dsh-arkme-${version}.tgz`,
  }
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function manager(options: {
  now?: () => number
  fetchImpl?: typeof fetch
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-update-'))
  return {
    root,
    value: new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 12 * 60 * 60_000,
      stateDirectory: root,
      installedVersion: '0.1.3',
      requestTimeoutMs: 1_000,
      now: options.now,
      fetchImpl: options.fetchImpl ?? (async () => updateResponse()),
    }),
  }
}

describe('plugin update metadata', () => {
  it('uses package.json as the installed-version fact', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(readInstalledPluginVersion()).toBe(manifest.version)
  })

  it('validates private update service origins', () => {
    expect(validatePluginUpdateServiceOrigin('https://api.jotmo.cc')).toBe('https://api.jotmo.cc')
    expect(() => validatePluginUpdateServiceOrigin('https://user:pass@example.com/path')).toThrow(/HTTPS origin/)
    expect(() => validatePluginUpdateServiceOrigin('https://registry.npmjs.org')).toThrow(/npm registry/)
  })
})

describe('ArkmePluginUpdateManager', () => {
  it('clears a terminal install result for an older update target', async () => {
    const now = 1_000_000
    const { value, root } = await manager({ now: () => now })
    await value.check({ manual: true })
    await new PluginUpdateInstallStateStore(root).write({
      schemaVersion: 1,
      jobId: 'old-update',
      phase: 'rolled-back',
      previousVersion: '0.1.2',
      targetVersion: '0.1.3',
      message: '已恢复旧版本文件，正在由 Arkme 重启 DSH…',
      updatedAtMillis: now,
    })

    await expect(value.installStatus()).resolves.toBeUndefined()
    await expect(readFile(join(root, 'plugin-update-install-state.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('clears a terminal install result after ten minutes', async () => {
    const now = 1_000_000
    const { value, root } = await manager({ now: () => now })
    await value.check({ manual: true })
    await new PluginUpdateInstallStateStore(root).write({
      schemaVersion: 1,
      jobId: 'expired-update',
      phase: 'failed',
      previousVersion: '0.1.3',
      targetVersion: '0.1.4',
      message: '新版本安装失败，已自动恢复旧版本。',
      updatedAtMillis: now - 10 * 60_000 - 1,
    })

    await expect(value.installStatus()).resolves.toBeUndefined()
    await expect(readFile(join(root, 'plugin-update-install-state.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a recent terminal result for the current update target', async () => {
    const now = 1_000_000
    const { value, root } = await manager({ now: () => now })
    await value.check({ manual: true })
    const currentRollback = {
      schemaVersion: 1 as const,
      jobId: 'current-rollback',
      phase: 'rolled-back' as const,
      previousVersion: '0.1.3',
      targetVersion: '0.1.4',
      message: '新版本安装失败，已自动恢复旧版本。',
      updatedAtMillis: now,
    }
    await new PluginUpdateInstallStateStore(root).write(currentRollback)

    await expect(value.installStatus()).resolves.toEqual(currentRollback)
  })

  it('keeps an active install regardless of its age or target', async () => {
    const now = 1_000_000
    const { value, root } = await manager({ now: () => now })
    await value.check({ manual: true })
    const activeInstall = {
      schemaVersion: 1 as const,
      jobId: 'active-install',
      phase: 'installing' as const,
      previousVersion: '0.1.2',
      targetVersion: '0.1.3',
      message: '正在安装 0.1.3…',
      updatedAtMillis: 1,
    }
    await new PluginUpdateInstallStateStore(root).write(activeInstall)

    await expect(value.installStatus()).resolves.toEqual(activeInstall)
  })

  it('checks the Jotmo private update endpoint with app/dsh/current version query params', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://api.jotmo.cc')
      expect(url.pathname).toBe('/api/public/v1/arkme/plugin-update/latest')
      expect(url.searchParams.get('app_version')).toBe('1.2.0')
      expect(url.searchParams.get('dsh_version')).toBe('0.1.0-rc.8')
      expect(url.searchParams.get('current_version')).toBe('0.1.3')
      expect(init?.headers).toEqual({ Accept: 'application/json' })
      expect(String(input)).not.toContain('registry.npmjs.org')
      return updateResponse()
    })
    const { value } = await manager({ fetchImpl })

    await expect(value.check({ manual: true })).resolves.toMatchObject({
      installedVersion: '0.1.3',
      latestVersion: '0.1.4',
      availability: 'available',
      level: 'normal',
      updateCommand: 'Arkme 应用内更新',
      restartRequired: true,
      stale: false,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('deduplicates concurrent checks into one private update request', async () => {
    let resolveResponse!: (response: Response) => void
    const fetchImpl = vi.fn(async () => await new Promise<Response>(resolve => { resolveResponse = resolve }))
    const { value } = await manager({ fetchImpl })

    const first = value.check({ manual: true })
    const second = value.check({ manual: true })
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledOnce() })
    resolveResponse(updateResponse())
    const [a, b] = await Promise.all([first, second])
    expect(a.latestVersion).toBe('0.1.4')
    expect(b.latestVersion).toBe('0.1.4')
  })

  it('treats a 404 private update response as no compatible newer version', async () => {
    const { value } = await manager({ fetchImpl: async () => new Response('', { status: 404 }) })

    await expect(value.check({ manual: true })).resolves.toMatchObject({
      availability: 'current',
      latestVersion: '0.1.3',
      checkFailed: false,
    })
  })

  it('keeps the last known update when a later check fails', async () => {
    let now = 1_000_000
    let healthy = true
    const { value, root } = await manager({
      now: () => now,
      fetchImpl: async () => healthy ? updateResponse() : new Response('bad gateway', { status: 503 }),
    })
    expect((await value.check({ manual: true })).availability).toBe('available')

    now += 61_000
    healthy = false
    const failed = await value.check({ manual: true })
    expect(failed).toMatchObject({ availability: 'available', latestVersion: '0.1.4', stale: true })
    const state = JSON.parse(await readFile(join(root, 'plugin-update-state.json'), 'utf8')) as Record<string, unknown>
    expect(state.consecutiveFailures).toBe(1)
    expect(state.lastKnownLatestVersion).toBe('0.1.4')
  })

  it('always refreshes when a user explicitly checks for updates', async () => {
    let now = 1_000_000
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
    const { value } = await manager({ now: () => now, fetchImpl })

    expect((await value.check({ manual: true })).availability).toBe('current')
    expect((await value.check({ manual: true })).availability).toBe('current')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('supports local acknowledgement for direct download updates', async () => {
    const update = {
      version: '0.1.4',
      releaseNotes: '紧急插件更新',
      downloadUrl: artifactUrl,
    }
    const { value } = await manager({ fetchImpl: async () => new Response(JSON.stringify(update), { status: 200 }) })
    await value.check({ manual: true })
    const acknowledged = await value.acknowledge(24)
    expect(acknowledged.acknowledged).toBe(true)
    expect(acknowledged.snoozedUntilMillis).toBeTypeOf('number')
  })
})
