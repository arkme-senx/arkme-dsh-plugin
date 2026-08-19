import { readFileSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmePluginUpdateManager,
  parseRegistryPackageMetadata,
  readInstalledPluginVersion,
  validateUpdateRegistryOrigin,
} from '../src/plugin-update.js'

function registryResponse(version: string, notice?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    name: '@senguoyun/dsh-arkme',
    version,
    ...(notice === undefined ? {} : { arkme: { updateNotice: notice } }),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function manager(options: {
  now?: () => number
  fetchImpl?: typeof fetch
  channel?: 'stable' | 'next'
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-update-'))
  return {
    root,
    value: new ArkmePluginUpdateManager({
      enabled: true,
      channel: options.channel ?? 'stable',
      registryUrl: 'https://registry.npmjs.org',
      intervalMs: 12 * 60 * 60_000,
      stateDirectory: root,
      installedVersion: '0.1.3',
      requestTimeoutMs: 1_000,
      now: options.now,
      fetchImpl: options.fetchImpl ?? (async () => registryResponse('0.1.4')),
    }),
  }
}

describe('plugin update metadata', () => {
  it('uses package.json as the installed-version fact', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(readInstalledPluginVersion()).toBe(manifest.version)
  })

  it('validates registry origins and sanitizes remote notice metadata', () => {
    expect(validateUpdateRegistryOrigin('https://registry.npmjs.org')).toBe('https://registry.npmjs.org')
    expect(() => validateUpdateRegistryOrigin('https://user:pass@example.com/path')).toThrow(/HTTPS origin/)
    expect(parseRegistryPackageMetadata({
      name: '@senguoyun/dsh-arkme',
      version: '0.1.4',
      arkme: { updateNotice: {
        schemaVersion: 1,
        level: 'critical',
        title: '安全更新',
        summary: '<script>alert(1)</script>',
        releaseNotesUrl: 'javascript:alert(1)',
        command: 'rm -rf /',
      } },
    })).toEqual({
      version: '0.1.4',
      notice: {
        schemaVersion: 1,
        level: 'critical',
        title: '安全更新',
        summary: '<script>alert(1)</script>',
      },
    })
  })
})

describe('ArkmePluginUpdateManager', () => {
  it('detects a newer stable version and projects only the fixed local command', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://registry.npmjs.org/%40senguoyun%2Fdsh-arkme/latest')
      expect(init?.headers).toEqual({ Accept: 'application/json' })
      return registryResponse('0.1.4', {
        schemaVersion: 1,
        level: 'important',
        title: '新增能力',
        summary: '请尽快更新',
        releaseNotesUrl: 'https://github.com/arkme-senx/arkme-dsh-plugin/releases/tag/v0.1.4',
        command: 'malicious command',
      })
    })
    const { value } = await manager({ fetchImpl })

    await expect(value.check({ manual: true })).resolves.toMatchObject({
      installedVersion: '0.1.3',
      latestVersion: '0.1.4',
      availability: 'available',
      level: 'important',
      updateCommand: 'dsh plugin --profile web up @senguoyun/dsh-arkme --latest',
      restartRequired: true,
      stale: false,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('deduplicates concurrent checks into one Registry request', async () => {
    let resolveResponse!: (response: Response) => void
    const fetchImpl = vi.fn(async () => await new Promise<Response>(resolve => { resolveResponse = resolve }))
    const { value } = await manager({ fetchImpl })

    const first = value.check({ manual: true })
    const second = value.check({ manual: true })
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledOnce() })
    resolveResponse(registryResponse('0.1.4'))
    const [a, b] = await Promise.all([first, second])
    expect(a.latestVersion).toBe('0.1.4')
    expect(b.latestVersion).toBe('0.1.4')
  })

  it('keeps the last known update when a later check fails', async () => {
    let now = 1_000_000
    let healthy = true
    const { value, root } = await manager({
      now: () => now,
      fetchImpl: async () => healthy ? registryResponse('0.1.4') : new Response('bad gateway', { status: 503 }),
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

  it('distinguishes current and ahead installs and rate-limits manual checks', async () => {
    let now = 1_000_000
    let latest = '0.1.3'
    const fetchImpl = vi.fn(async () => registryResponse(latest))
    const { value } = await manager({ now: () => now, fetchImpl })

    expect((await value.check({ manual: true })).availability).toBe('current')
    expect((await value.check({ manual: true })).availability).toBe('current')
    expect(fetchImpl).toHaveBeenCalledOnce()
    now += 61_000
    latest = '0.1.2'
    expect((await value.check({ manual: true })).availability).toBe('ahead')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('supports local acknowledgement but never snoozes critical updates', async () => {
    const { value } = await manager({
      fetchImpl: async () => registryResponse('0.1.4', { schemaVersion: 1, level: 'critical' }),
    })
    await value.check({ manual: true })
    const acknowledged = await value.acknowledge(24)
    expect(acknowledged.acknowledged).toBe(true)
    expect(acknowledged.snoozedUntilMillis).toBeUndefined()
  })

  it('uses the next dist-tag without accepting a remote update command', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('/next')
      return registryResponse('0.2.0-beta.1')
    })
    const { value } = await manager({ channel: 'next', fetchImpl })
    const status = await value.check({ manual: true })
    expect(status.updateCommand).toBe('dsh plugin --profile web up @senguoyun/dsh-arkme@next --latest')
  })
})
