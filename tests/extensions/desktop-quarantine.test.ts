import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeDesktopExtensionQuarantine,
  type DesktopExtensionQuarantineReceipt,
} from '../../src/extensions/desktop-quarantine.js'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import type { ArkmeInstalledExtension } from '../../src/extensions/types.js'

const QUARANTINE_ID = '01234567-89ab-4cde-8fab-0123456789ab'

function installed(root: string, packageName = '@example/peer-portrait'): ArkmeInstalledExtension {
  return {
    extensionId: 'ext-peer-portrait',
    installedVersion: '1.0.0',
    artifactSha256: 'sha256',
    artifactPath: join(root, 'peer-portrait.tgz'),
    manifest: {
      format: 'arkme-cordis-extension',
      format_version: 1,
      name: '同事画像',
      description: '',
      version: '1.0.0',
      runtime: { dsh: '*', arkme_provider_contract: 1 },
      halves: { host: true, client: true },
      permissions: [],
      entrypoints: { host: 'host.js', client: 'client.js' },
    },
    enabled: true,
    active: true,
    profilePackageName: packageName,
    executionModel: 'dsh-native',
    permissionSnapshot: [],
    updateChannel: 'stable',
    installedAtMillis: 1,
    lastCheckedAtMillis: 1,
  }
}

function receipt(overrides: Partial<DesktopExtensionQuarantineReceipt> = {}): DesktopExtensionQuarantineReceipt {
  return {
    schemaVersion: 1,
    quarantineId: QUARANTINE_ID,
    environment: 'test',
    phase: 'active',
    mode: 'targeted',
    createdAtMillis: 1_787_900_000_000,
    updatedAtMillis: 1_787_900_000_000,
    runtimeReleaseId: 'electron-runtime-v1-0123456789abcdef0123456789abcdef',
    failureSummary: '扩展 @example/peer-portrait 启动时加载失败，已自动停用',
    failureLogTail: 'Cannot find package imported from peer-portrait',
    entries: [{
      packageName: '@example/peer-portrait',
      dependencySpec: 'link:../peer-portrait',
      originalBundleIndex: 3,
    }],
    ...overrides,
  }
}

async function writeReceipt(dshHome: string, value: unknown, id = QUARANTINE_ID): Promise<string> {
  const directory = join(dshHome, 'arkme-self', 'desktop-extension-quarantine', id)
  await mkdir(directory, { recursive: true })
  const receiptPath = join(directory, 'receipt.json')
  await writeFile(receiptPath, `${JSON.stringify(value, undefined, 2)}\n`)
  return receiptPath
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'arkme-desktop-quarantine-'))
  const dshHome = join(root, 'dsh')
  const store = new ArkmeExtensionInstallStore(join(dshHome, 'arkme-self', 'extensions'))
  const setProfileEnabled = vi.fn(async () => undefined)
  const requestRestart = vi.fn(async () => undefined)
  const activePackages = new Set<string>()
  const quarantine = new ArkmeDesktopExtensionQuarantine({
    dshHome,
    environment: 'test',
    installStore: store,
    setProfileEnabled,
    requestRestart,
    isPackageActive: packageName => activePackages.has(packageName),
    now: () => 1_787_900_100_000,
  })
  return {
    root, dshHome, store, setProfileEnabled, requestRestart, activePackages, quarantine,
  }
}

describe('desktop extension quarantine', () => {
  it('converges a matching installed extension to disabled and preserves a clear reason', async () => {
    const fixture = await setup()
    fixture.store.put(installed(fixture.root))
    const receiptPath = await writeReceipt(fixture.dshHome, receipt())

    await fixture.quarantine.reconcile()

    expect(fixture.store.get('ext-peer-portrait')).toMatchObject({
      enabled: false,
      active: false,
      lastError: '扩展 @example/peer-portrait 启动时加载失败，已自动停用',
    })
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
      phase: 'active',
      entries: [{
        packageName: '@example/peer-portrait',
        synchronizedAtMillis: 1_787_900_100_000,
      }],
    })
    expect(await fixture.quarantine.status()).toMatchObject({
      active: true,
      mode: 'targeted',
      failureSummary: '扩展 @example/peer-portrait 启动时加载失败，已自动停用',
      entries: [{
        packageName: '@example/peer-portrait',
        extensionId: 'ext-peer-portrait',
        dismissed: false,
      }],
    })

    fixture.store.put({ ...fixture.store.get('ext-peer-portrait')!, enabled: true, active: true, lastError: undefined })
    await fixture.quarantine.reconcile()
    expect(fixture.store.get('ext-peer-portrait')).toMatchObject({
      enabled: false,
      active: false,
      lastError: '扩展 @example/peer-portrait 启动时加载失败，已自动停用',
    })
    fixture.store.close()
  })

  it('keeps receipt-only local extensions visible and requires explicit re-enable plus restart', async () => {
    const fixture = await setup()
    const receiptPath = await writeReceipt(fixture.dshHome, receipt({
      mode: 'local-safe-mode',
      failureSummary: '无法确定具体故障扩展，已停用 2 个本地开发扩展',
      entries: [
        { packageName: '@example/local-a', dependencySpec: 'link:../a', originalBundleIndex: 2 },
        { packageName: '@example/local-b', dependencySpec: 'file:../b', originalBundleIndex: 3 },
      ],
    }))

    await fixture.quarantine.reconcile()
    expect((await fixture.quarantine.status()).entries.map(item => item.packageName)).toEqual([
      '@example/local-a', '@example/local-b',
    ])

    await fixture.quarantine.reenable('@example/local-a')

    expect(fixture.setProfileEnabled).toHaveBeenCalledWith('@example/local-a', true)
    expect(fixture.requestRestart).toHaveBeenCalledWith({
      packageName: '@example/local-a',
      previousProfileIncluded: false,
    })
    const updatedReceipt = JSON.parse(await readFile(receiptPath, 'utf8')) as DesktopExtensionQuarantineReceipt
    expect(updatedReceipt.entries[0]).toMatchObject({
      packageName: '@example/local-a', reenableRequestedAtMillis: 1_787_900_100_000,
    })
    expect((await fixture.quarantine.status()).entries.find(item => item.packageName === '@example/local-a'))
      .toMatchObject({ resolved: false })
    fixture.store.close()
  })

  it('dismisses only the notice and resolves entries only after the package is active', async () => {
    const fixture = await setup()
    const receiptPath = await writeReceipt(fixture.dshHome, receipt())
    await fixture.quarantine.reconcile()

    await fixture.quarantine.dismiss('@example/peer-portrait')
    expect((await fixture.quarantine.status()).entries[0]).toMatchObject({
      dismissed: true,
      resolved: false,
    })

    await fixture.quarantine.resolveActive()
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({ phase: 'active' })

    await fixture.quarantine.reenable('@example/peer-portrait')
    fixture.activePackages.add('@example/peer-portrait')
    await fixture.quarantine.resolveActive()

    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
      phase: 'resolved',
      entries: [{ packageName: '@example/peer-portrait', resolvedAtMillis: 1_787_900_100_000 }],
    })
    expect((await fixture.quarantine.status()).active).toBe(false)
    fixture.store.close()
  })

  it('reports managed-restart health only for an explicitly requested package and resolves it atomically', async () => {
    const fixture = await setup()
    const profileDirectory = join(fixture.dshHome, 'profiles', 'web')
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(join(profileDirectory, 'package.json'), JSON.stringify({
      dependencies: { '@example/peer-portrait': 'link:../../peer-portrait' },
      dsh: { profile: { bundles: ['@example/peer-portrait'] } },
    }))
    const receiptPath = await writeReceipt(fixture.dshHome, receipt({
      entries: [{
        packageName: '@example/peer-portrait',
        dependencySpec: 'link:../peer-portrait',
        originalBundleIndex: 3,
        reenableRequestedAtMillis: 1_787_900_050_000,
      }],
    }))
    fixture.activePackages.add('@example/peer-portrait')

    await expect(fixture.quarantine.health('@example/peer-portrait')).resolves.toEqual({
      profileEnabled: true,
      active: true,
    })

    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
      phase: 'resolved',
      entries: [{
        packageName: '@example/peer-portrait',
        resolvedAtMillis: 1_787_900_100_000,
      }],
    })
    await expect(fixture.quarantine.health('@example/not-requested'))
      .rejects.toThrow('没有活动的启动隔离记录')
    fixture.store.close()
  })

  it('rejects malformed, wrong-environment, and protected-package receipts without store mutation', async () => {
    for (const value of [
      { ...receipt(), schemaVersion: 2 },
      receipt({ environment: 'prod' }),
      receipt({ entries: [{ packageName: '@senguoyun/dsh-arkme', dependencySpec: 'link:../arkme', originalBundleIndex: 1 }] }),
      receipt({ entries: [{ packageName: '@deepseek-ai/dsh-base', dependencySpec: '1.0.0', originalBundleIndex: 0 }] }),
    ]) {
      const fixture = await setup()
      fixture.store.put(installed(fixture.root))
      await writeReceipt(fixture.dshHome, value)

      await fixture.quarantine.reconcile()

      expect(fixture.store.get('ext-peer-portrait')).toMatchObject({ enabled: true })
      expect((await fixture.quarantine.status()).active).toBe(false)
      fixture.store.close()
    }
  })

  it('does not discover receipts under the other environment DSH Home', async () => {
    const fixture = await setup()
    const productionHome = join(fixture.root, 'production-dsh')
    await writeReceipt(productionHome, receipt({ environment: 'prod' }))

    await fixture.quarantine.reconcile()

    expect((await fixture.quarantine.status()).active).toBe(false)
    fixture.store.close()
  })
})
