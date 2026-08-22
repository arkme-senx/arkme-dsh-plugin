import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'

const directories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'arkme-extension-engagement-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('extension marketplace engagement metrics', () => {
  it('persists one opaque installation identity across store reopen', () => {
    const directory = temporaryDirectory()
    const first = new ArkmeExtensionInstallStore(directory)
    const firstID = first.installationInstanceId()
    first.close()

    const reopened = new ArkmeExtensionInstallStore(directory)
    expect(reopened.installationInstanceId()).toBe(firstID)
    expect(firstID).toMatch(/^[a-f0-9-]{36}$/)
    reopened.close()
  })

  it('uses authenticated engagement endpoints with server-owned counts', async () => {
    const post = vi.fn(async <T>(path: string): Promise<T> => {
      if (path.endsWith('/open')) return { extension_id: 'ext_metrics', open_count: 3, idempotent_replay: false } as T
      if (path.endsWith('/update')) return { extension_id: 'ext_metrics', installed: true, install_user_count: 2 } as T
      return { installation_id: 'profile-a', install_user_counts: { ext_metrics: 2 } } as T
    })
    const client = new ExtensionPublishClient(post)
    await client.recordOpen('ext_metrics')
    await client.setInstallationState({ extension_id: 'ext_metrics', installation_id: 'profile-a', installed: true })
    await client.syncInstallationStates({ installation_id: 'profile-a', installed_extension_ids: ['ext_metrics'] })

    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/extensions/open', { extension_id: 'ext_metrics' }, undefined)
    expect(post).toHaveBeenNthCalledWith(2, '/api/v1/extensions/installation-state/update', {
      extension_id: 'ext_metrics', installation_id: 'profile-a', installed: true,
    }, undefined)
    expect(post).toHaveBeenNthCalledWith(3, '/api/v1/extensions/installation-state/sync', {
      installation_id: 'profile-a', installed_extension_ids: ['ext_metrics'],
    }, undefined)
  })

  it('reports a view only after public detail succeeds and keeps reporting best effort', async () => {
    const requests: string[] = []
    const post = async <T>(path: string): Promise<T> => {
      requests.push(path)
      if (path.endsWith('/installation-state/sync')) throw new Error('old service')
      if (path.endsWith('/detail')) return {
        extension_id: 'ext_metrics', name: 'Metrics', description: 'Metrics', visibility: 'public',
      } as T
      if (path.endsWith('/open')) throw new Error('telemetry unavailable')
      throw new Error(`unexpected ${path}`)
    }
    const directory = temporaryDirectory()
    const store = new ArkmeExtensionInstallStore(join(directory, 'state'))
    const manager = new ArkmeExtensionManager(new ExtensionPublishClient(post), store, {} as never, {
      artifactDirectory: join(directory, 'artifacts'), trustedSigningKeys: '',
    })

    await manager.reconcileInstallationMetrics()
    await expect(manager.inspect('ext_metrics')).resolves.toMatchObject({ extension_id: 'ext_metrics' })
    expect(requests).toContain('/api/public/v1/extensions/detail')
    expect(requests).toContain('/api/v1/extensions/open')
    store.close()
  })
})
