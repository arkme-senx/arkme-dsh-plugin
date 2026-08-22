import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginUpdateStore } from '../src/client/plugin-update-store.js'
import type { ArkmePluginUpdateStatus } from '../src/types.js'

function updateStatus(patch: Partial<ArkmePluginUpdateStatus> = {}): ArkmePluginUpdateStatus {
  return {
    enabled: true,
    installedVersion: '0.1.3',
    latestVersion: '0.1.4',
    availability: 'available',
    level: 'normal',
    title: 'Arkme 插件有新版本',
    summary: '修复与体验更新',
    stale: false,
    checkFailed: false,
    checking: false,
    acknowledged: false,
    updateCommand: 'Arkme 应用内更新',
    canInstallInApp: false,
    installBlockedReason: 'runtime-unavailable',
    restartRequired: true,
    ...patch,
  }
}

describe('ArkmePluginUpdateStore', () => {
  it('checks for a fresh version whenever the Web App starts or becomes visible', async () => {
    const documentTarget = new EventTarget()
    Object.defineProperty(documentTarget, 'visibilityState', { configurable: true, value: 'visible' })
    vi.stubGlobal('document', documentTarget)
    const call = vi.fn(async (operation: string) => {
      if (operation === 'plugin.update.install-status') return undefined
      return updateStatus()
    })
    const store = new ArkmePluginUpdateStore(call as never)
    const stop = store.start()
    try {
      await vi.waitFor(() => {
        expect(call).toHaveBeenCalledWith('plugin.update.check')
        expect(store.getSnapshot().checked).toBe(true)
      })
      call.mockClear()
      document.dispatchEvent(new Event('visibilitychange'))

      await vi.waitFor(() => {
        expect(call).toHaveBeenCalledWith('plugin.update.check')
      })
    } finally {
      stop()
      vi.unstubAllGlobals()
    }
  })

  it('loads Host-owned status and acknowledges only through the typed operation', async () => {
    const call = vi.fn(async (operation: string) => {
      if (operation === 'plugin.update.acknowledge') return updateStatus({ acknowledged: true })
      return updateStatus()
    })
    const store = new ArkmePluginUpdateStore(call as never)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({ checked: true, busy: false, error: '' })
    expect(store.getSnapshot().status?.latestVersion).toBe('0.1.4')
    await store.acknowledge(24)
    expect(call).toHaveBeenLastCalledWith('plugin.update.acknowledge', { snoozeHours: 24 })
    expect(store.getSnapshot().status?.acknowledged).toBe(true)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps the last status when a local Host read fails', async () => {
    let healthy = true
    const store = new ArkmePluginUpdateStore((async () => {
      if (!healthy) throw new Error('local host unavailable')
      return updateStatus()
    }) as never)
    await store.refresh()
    healthy = false
    await store.refresh(true)

    expect(store.getSnapshot().status?.availability).toBe('available')
    expect(store.getSnapshot().error).toBe('local host unavailable')
    expect(store.getSnapshot().busy).toBe(false)
  })

  it('starts a Host-owned install job and keeps its restart phase locally', async () => {
    const install = {
      schemaVersion: 1 as const,
      jobId: 'job-1',
      phase: 'preparing' as const,
      previousVersion: '0.1.3',
      targetVersion: '0.1.4',
      message: '准备更新…',
      updatedAtMillis: 1,
    }
    const call = vi.fn(async (operation: string) => {
      if (operation === 'plugin.update.install') return install
      return undefined
    })
    const store = new ArkmePluginUpdateStore(call as never)
    await expect(store.install()).resolves.toEqual(install)
    expect(store.getSnapshot().install).toEqual(install)
    expect(call).toHaveBeenCalledWith('plugin.update.install')
    store.stop()
  })
})
