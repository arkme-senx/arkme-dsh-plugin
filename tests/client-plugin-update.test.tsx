import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginUpdateStore } from '../src/client/plugin-update-store.js'
import { deriveArkmeUpdatePresentation } from '../src/client/update-presentation.js'
import type { ArkmePluginUpdateInstallSnapshot, ArkmePluginUpdateStatus } from '../src/types.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function presentation(store: ArkmePluginUpdateStore) {
  return deriveArkmeUpdatePresentation({ app: { checked: true, busy: false, error: '' }, plugin: store.getSnapshot() })
}

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
  const activeJob: ArkmePluginUpdateInstallSnapshot = {
    schemaVersion: 1, jobId: 'monitored-job', phase: 'installing', previousVersion: '0.1.3',
    targetVersion: '0.1.4', message: '正在安装', updatedAtMillis: 1_000_000,
  }

  it.each(['resolve', 'reject'] as const)('settles a pending command from a confirmed failure and ignores its late %s after retry', async completion => {
    const old = deferred<ArkmePluginUpdateInstallSnapshot>()
    const retry = deferred<ArkmePluginUpdateInstallSnapshot>()
    let commands = 0
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install') return ++commands === 1 ? old.promise : retry.promise
      if (operation === 'plugin.update.install-status') return { ...activeJob, phase: 'failed' }
      return updateStatus()
    }) as never)
    try {
      await store.refresh()
      const first = store.install()
      await store.refreshInstallStatus(false)
      expect(store.getSnapshot().installPending).toBe(false)
      expect(presentation(store).primary).toMatchObject({ failed: true, active: false })
      const second = store.install()
      if (completion === 'resolve') old.resolve(activeJob)
      else old.reject(new Error('old connection closed'))
      await first
      const duplicate = store.install()
      await Promise.resolve()
      expect(commands).toBe(2)
      expect(store.getSnapshot().installPending).toBe(true)
      retry.resolve({ ...activeJob, jobId: 'retry-job' })
      await Promise.all([second, duplicate])
      expect(store.getSnapshot().install?.jobId).toBe('retry-job')
    } finally { store.stop() }
  })

  it.each(['lost', 'pending'] as const)('clears a %s command when its requested target is actually running without a job record', async mode => {
    const command = deferred<ArkmePluginUpdateInstallSnapshot>()
    let current = false
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install') return command.promise
      if (operation === 'plugin.update.install-status') return undefined
      return current ? updateStatus({ installedVersion: '0.1.4', availability: 'current' }) : updateStatus()
    }) as never)
    try {
      await store.refresh()
      const pending = store.install()
      if (mode === 'lost') { command.reject(new Error('connection closed')); await pending }
      current = true
      await store.refresh()
      await store.refreshInstallStatus(false)
      expect(store.getSnapshot()).toMatchObject({ installPending: false, installError: '', installWarning: '' })
      expect(presentation(store).items).toEqual([])
      command.resolve(activeJob)
      await pending
      expect(presentation(store).items).toEqual([])
    } finally { store.stop() }
  })

  it('does not erase an error for a target newer than the running version', async () => {
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install') throw new Error('new target failed')
      return updateStatus({ installedVersion: '0.1.4', latestVersion: '0.1.5' })
    }) as never)
    try {
      await store.refresh(); await store.install(); await store.refresh()
      expect(store.getSnapshot().installError).toBe('new target failed')
      expect(presentation(store).primary?.failed).toBe(true)
    } finally { store.stop() }
  })

  it('does not mistake an older-version job for acceptance of a pending newer update', async () => {
    const command = deferred<ArkmePluginUpdateInstallSnapshot>()
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install') return command.promise
      if (operation === 'plugin.update.install-status') return { ...activeJob, phase: 'failed' }
      return updateStatus({ installedVersion: '0.1.4', latestVersion: '0.1.5' })
    }) as never)
    try {
      await store.refresh()
      const pending = store.install()
      await store.refreshInstallStatus(false)
      expect(store.getSnapshot().installPending).toBe(true)
      expect(presentation(store).primary).toMatchObject({ active: true, latestVersion: '0.1.5' })
      command.resolve({ ...activeJob, targetVersion: '0.1.5', jobId: 'newer-job' })
      await pending
      expect(store.getSnapshot().install?.jobId).toBe('newer-job')
    } finally { store.stop() }
  })

  it('recovers an initially unavailable install-status read after Host startup', async () => {
    vi.useFakeTimers()
    let reads = 0
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install-status') {
        if (++reads === 1) throw new Error('Host starting')
        return activeJob
      }
      return updateStatus()
    }) as never)
    try {
      store.start()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(reads).toBeGreaterThan(1)
      expect(presentation(store).primary).toMatchObject({ active: true, uncertain: false, available: false })
    } finally { store.stop(); vi.useRealTimers() }
  })

  it('bounds unavailable startup reads, exposes recovery, and gives a deduplicated manual check visible feedback', async () => {
    vi.useFakeTimers()
    let recover = false
    const response = deferred<ArkmePluginUpdateInstallSnapshot | undefined>()
    const call = vi.fn(async (operation: string) => {
      if (operation !== 'plugin.update.install-status') return updateStatus()
      if (recover) return response.promise
      throw new Error('offline')
    })
    const store = new ArkmePluginUpdateStore(call as never)
    try {
      store.start()
      await vi.advanceTimersByTimeAsync(300_000)
      const reads = call.mock.calls.length
      expect(presentation(store).primary).toMatchObject({ uncertain: true, available: false, failed: false })
      await vi.advanceTimersByTimeAsync(300_000)
      expect(call.mock.calls.length).toBe(reads)
      recover = true
      const first = store.checkInstallStatus()
      const second = store.checkInstallStatus()
      expect(store.getSnapshot().installStatusChecking).toBe(true)
      await Promise.resolve()
      expect(call.mock.calls.filter(([op]) => op === 'plugin.update.install-status')).toHaveLength(5)
      response.resolve(undefined)
      await Promise.all([first, second])
      expect(store.getSnapshot().installStatusChecking).toBe(false)
      expect(presentation(store).primary).toMatchObject({ available: true, uncertain: false })
    } finally { store.stop(); vi.useRealTimers() }
  })

  it('ends a hung recovery check, aborts only the read, and allows another check', async () => {
    vi.useFakeTimers()
    let readSignal: AbortSignal | undefined
    const store = new ArkmePluginUpdateStore((async (operation: string, _params: unknown, signal: AbortSignal) => {
      if (operation === 'plugin.update.install-status') {
        readSignal = signal
        return new Promise(() => undefined)
      }
      return updateStatus()
    }) as never)
    try {
      const check = store.checkInstallStatus()
      await vi.advanceTimersByTimeAsync(15_001)
      await check
      expect(readSignal?.aborted).toBe(true)
      expect(store.getSnapshot()).toMatchObject({ installStatusChecking: false })
      expect(presentation(store).primary).toMatchObject({ uncertain: true, failed: false, available: false })
      expect(store.getSnapshot().installStatusFeedback).toContain('稍后再检查')
      const next = store.checkInstallStatus()
      expect(store.getSnapshot().installStatusChecking).toBe(true)
      store.stop()
      await next
      expect(store.getSnapshot().installStatusChecking).toBe(false)
    } finally { store.stop(); vi.useRealTimers() }
  })

  it('does not resurrect an old failure returned after the target is already running', async () => {
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install-status') return { ...activeJob, phase: 'failed' }
      return updateStatus({ installedVersion: '0.1.4', availability: 'current' })
    }) as never)
    try {
      await store.refresh()
      await store.refreshInstallStatus(false)
      expect(presentation(store).items).toEqual([])
    } finally { store.stop() }
  })

  it.each(['accepted', 'restored', 'offline', 'unanswered'] as const)(
    'shows an uncertain status when %s installation makes no progress, without retrying installation', async mode => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000_000)
      const unanswered = deferred<ArkmePluginUpdateInstallSnapshot>()
      let offline = false
      const call = vi.fn(async (operation: string) => {
        if (operation === 'plugin.update.install') return activeJob
        if (operation !== 'plugin.update.install-status') return updateStatus()
        if (offline && mode === 'offline') throw new Error('Host offline')
        if (offline && mode === 'unanswered') return unanswered.promise
        return activeJob
      })
      const store = new ArkmePluginUpdateStore(call as never)
      try {
        await store.refresh()
        if (mode === 'accepted') await store.install()
        else await store.refreshInstallStatus(false)
        offline = true
        await vi.advanceTimersByTimeAsync(120_001)
        expect(store.getSnapshot().installWarning).toContain('长时间')
        expect(store.getSnapshot().installError).toBe('')
        expect(presentation(store).primary).toMatchObject({ uncertain: true, active: false, failed: false })
        expect(call.mock.calls.filter(([operation]) => operation === 'plugin.update.install')).toHaveLength(mode === 'accepted' ? 1 : 0)
      } finally {
        store.stop()
        unanswered.resolve(activeJob)
        await Promise.resolve()
        vi.useRealTimers()
      }
    },
  )

  it('does not reset a stalled deadline on repeated reads, but recovers when progress advances', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    let job = activeJob
    const store = new ArkmePluginUpdateStore((async () => job) as never)
    try {
      await store.refreshInstallStatus(false)
      await vi.advanceTimersByTimeAsync(120_001)
      await store.refreshInstallStatus(false)
      expect(store.getSnapshot().installWarning).not.toBe('')
      job = { ...activeJob, phase: 'restarting', updatedAtMillis: Date.now() }
      await store.refreshInstallStatus(false)
      expect(store.getSnapshot().installWarning).toBe('')
      expect(presentation(store).primary).toMatchObject({ active: true, restarting: true })
      job = { ...job, phase: 'succeeded', updatedAtMillis: Date.now() + 1 }
      await store.refreshInstallStatus(false)
      await vi.advanceTimersByTimeAsync(120_001)
      expect(presentation(store).items).toEqual([])
    } finally { store.stop(); vi.useRealTimers() }
  })

  it('monitors a delayed install command and ignores its old terminal job until the new job is accepted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const response = deferred<ArkmePluginUpdateInstallSnapshot>()
    const old = { ...activeJob, jobId: 'old-job', phase: 'failed' as const }
    const call = vi.fn(async (operation: string) => operation === 'plugin.update.install'
      ? response.promise : operation === 'plugin.update.install-status' ? old : updateStatus())
    const store = new ArkmePluginUpdateStore(call as never)
    try {
      await store.refreshInstallStatus(false)
      const pending = store.install()
      await vi.advanceTimersByTimeAsync(120_001)
      expect(presentation(store).primary).toMatchObject({ uncertain: true, active: false, failed: false })
      await store.refreshInstallStatus(false)
      expect(presentation(store).primary).toMatchObject({ uncertain: true, failed: false })
      const duplicate = store.install()
      expect(call.mock.calls.filter(([operation]) => operation === 'plugin.update.install')).toHaveLength(1)
      response.resolve({ ...activeJob, updatedAtMillis: Date.now() })
      await Promise.all([pending, duplicate])
      expect(presentation(store).primary).toMatchObject({ active: true, uncertain: false })
    } finally { store.stop(); vi.useRealTimers() }
  })

  it('does not reload a healthy old version just because its install-status API is unavailable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const reload = vi.fn()
    vi.stubGlobal('location', { reload, origin: 'http://localhost' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('old page', { status: 200 })))
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install') return activeJob
      if (operation === 'plugin.update.install-status') throw new Error('status unavailable')
      return updateStatus()
    }) as never)
    try {
      await store.refresh()
      await store.install()
      await vi.advanceTimersByTimeAsync(120_001)
      expect(reload).not.toHaveBeenCalled()
      expect(presentation(store).primary).toMatchObject({ uncertain: true, failed: false })
    } finally { store.stop(); vi.unstubAllGlobals(); vi.useRealTimers() }
  })

  it('keeps a Host-confirmed new job when the older install command connection subsequently fails', async () => {
    const response = deferred<ArkmePluginUpdateInstallSnapshot>()
    const store = new ArkmePluginUpdateStore((async (operation: string) => operation === 'plugin.update.install'
      ? response.promise : operation === 'plugin.update.install-status' ? activeJob : updateStatus()) as never)
    try {
      const pending = store.install()
      await store.refreshInstallStatus(false)
      response.reject(new Error('command connection closed during restart'))
      await pending
      expect(store.getSnapshot()).toMatchObject({ install: activeJob, installPending: false, installError: '' })
      expect(presentation(store).primary).toMatchObject({ active: true, failed: false })
    } finally { store.stop() }
  })

  it('reloads once version status confirms a replacement Host after an install-status error', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    let restarted = false
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install') return activeJob
      if (operation === 'plugin.update.install-status') throw new Error('old API unavailable')
      return restarted ? updateStatus({ installedVersion: '0.1.4', availability: 'current' }) : updateStatus()
    }) as never)
    try {
      await store.refresh()
      await store.install()
      restarted = true
      await store.refreshInstallStatus()
      expect(reload).toHaveBeenCalledOnce()
    } finally { store.stop(); vi.unstubAllGlobals() }
  })

  it.each(['failed', 'succeeded', 'empty', 'error'] as const)('ignores an old %s poll after a new retry was accepted', async kind => {
    const old = deferred<ArkmePluginUpdateInstallSnapshot | undefined>()
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const fresh = { ...activeJob, jobId: 'retry-job', phase: 'preparing' as const }
    const store = new ArkmePluginUpdateStore((async (operation: string) => operation === 'plugin.update.install-status'
      ? old.promise : operation === 'plugin.update.install' ? fresh : updateStatus()) as never)
    try {
      const poll = store.refreshInstallStatus()
      await store.install()
      if (kind === 'error') old.reject(new Error('old request failed'))
      else old.resolve(kind === 'empty' ? undefined : { ...activeJob, jobId: 'old-job', phase: kind })
      await poll
      expect(store.getSnapshot()).toMatchObject({ install: fresh, installError: '' })
      expect(reload).not.toHaveBeenCalled()
    } finally { store.stop(); vi.unstubAllGlobals() }
  })

  it('does not let a slower poll or a regressive same-job snapshot replace newer progress', async () => {
    const old = deferred<ArkmePluginUpdateInstallSnapshot>()
    let reads = 0
    const fresh = { ...activeJob, phase: 'restarting' as const, updatedAtMillis: 1_000_010 }
    const store = new ArkmePluginUpdateStore((async () => ++reads === 1 ? old.promise : reads === 2 ? fresh : activeJob) as never)
    try {
      const first = store.refreshInstallStatus(false)
      await store.refreshInstallStatus(false)
      old.resolve(activeJob)
      await first
      expect(store.getSnapshot().install).toEqual(fresh)
      await store.refreshInstallStatus(false)
      expect(store.getSnapshot().install).toEqual(fresh)
    } finally { store.stop() }
  })

  it('does not resurrect polling or update state when an in-flight read resolves after stop', async () => {
    vi.useFakeTimers()
    const response = deferred<ArkmePluginUpdateInstallSnapshot>()
    const store = new ArkmePluginUpdateStore((async () => response.promise) as never)
    try {
      const read = store.refreshInstallStatus(false)
      store.stop()
      response.resolve(activeJob)
      await read
      expect(store.getSnapshot().install).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally { store.stop(); vi.useRealTimers() }
  })

  it('reloads the old page when a new Host retires an active job after restart', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    let restarted = false
    const install = {
      schemaVersion: 1 as const, jobId: 'restart-job', phase: 'installing' as const,
      previousVersion: '0.1.3', targetVersion: '0.1.4', message: '正在安装', updatedAtMillis: Date.now(),
    }
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install-status') return restarted ? undefined : install
      return restarted ? updateStatus({ installedVersion: '0.1.4', availability: 'current' }) : updateStatus()
    }) as never)
    try {
      await store.refresh()
      await store.refreshInstallStatus(false)
      restarted = true
      await store.refreshInstallStatus()
      expect(reload).toHaveBeenCalledOnce()
      expect(presentation(store).items).toEqual([])
      await store.refreshInstallStatus()
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      store.stop()
      vi.unstubAllGlobals()
    }
  })

  it.each(['manual', 'visible'] as const)('does not show install progress during a delayed %s update check', async trigger => {
    const current = updateStatus({ installedVersion: '0.1.4', availability: 'current' })
    const response = deferred<ArkmePluginUpdateStatus>()
    let delayCheck = false
    const documentTarget = new EventTarget()
    Object.defineProperty(documentTarget, 'visibilityState', { value: 'visible' })
    vi.stubGlobal('document', documentTarget)
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation === 'plugin.update.install-status') return undefined
      return operation === 'plugin.update.check' && delayCheck ? response.promise : current
    }) as never)
    store.start()
    try {
      await store.refresh()
      delayCheck = true
      if (trigger === 'visible') document.dispatchEvent(new Event('visibilitychange'))
      else void store.refresh(true)
      expect(store.getSnapshot().busy).toBe(true)
      expect(presentation(store).items).toEqual([])
      response.resolve(current)
      await store.refresh()
      expect(presentation(store).items).toEqual([])
    } finally {
      response.resolve(current)
      await store.refresh()
      store.stop()
      vi.unstubAllGlobals()
    }
  })

  it.each(['failed', 'rolled-back'] as const)('renders one pending state when retrying %s and coalesces duplicate requests', async phase => {
    const response = deferred<ArkmePluginUpdateInstallSnapshot>()
    const checkResponse = deferred<ArkmePluginUpdateStatus>()
    const oldJob: ArkmePluginUpdateInstallSnapshot = { schemaVersion: 1, jobId: 'old-job', phase, previousVersion: '0.1.3', targetVersion: '0.1.4', message: '旧失败信息', updatedAtMillis: Date.now() }
    const newJob: ArkmePluginUpdateInstallSnapshot = { ...oldJob, jobId: 'new-job', phase: 'preparing', message: '正在准备更新' }
    const call = vi.fn(async (operation: string) => {
      if (operation === 'plugin.update.install') return response.promise
      if (operation === 'plugin.update.check') return checkResponse.promise
      if (operation === 'plugin.update.install-status') return oldJob
      return updateStatus()
    })
    const store = new ArkmePluginUpdateStore(call as never)
    try {
      await store.refresh()
      await store.refreshInstallStatus(false)
      const first = store.install()
      const duplicate = store.install()
      // A concurrent check completing must not erase the install-request state.
      const check = store.refresh(true)
      checkResponse.resolve(updateStatus())
      await check
      expect(store.getSnapshot()).toMatchObject({ busy: true, installPending: true })
      const item = presentation(store).primary!
      expect(item).toMatchObject({ active: true, failed: false, ready: false, phaseMessage: '正在准备更新' })
      expect(call.mock.calls.filter(([operation]) => operation === 'plugin.update.install')).toHaveLength(1)
      response.resolve(newJob)
      expect(await first).toEqual(newJob)
      expect(await duplicate).toEqual(newJob)
      expect(store.getSnapshot()).toMatchObject({ installPending: false, busy: false, install: newJob })
    } finally {
      response.resolve(newJob)
      checkResponse.resolve(updateStatus())
      await Promise.resolve()
      await Promise.resolve()
      store.stop()
    }
  })

  it('restores the retry action with the new error when an install request fails', async () => {
    const response = deferred<ArkmePluginUpdateInstallSnapshot>()
    const call = vi.fn(async (operation: string) => operation === 'plugin.update.install' ? response.promise : updateStatus())
    const store = new ArkmePluginUpdateStore(call as never)
    await store.refresh()
    const pending = store.install()
    expect(presentation(store).primary).toMatchObject({ active: true, failed: false })
    response.reject(new Error('新的请求错误'))
    await pending
    expect(store.getSnapshot()).toMatchObject({ installPending: false, busy: false })
    expect(presentation(store).primary).toMatchObject({ active: false, failed: true, phaseMessage: '新的请求错误' })
    store.stop()
  })

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
        expect(call).toHaveBeenCalledWith('plugin.update.check', undefined, expect.any(AbortSignal))
        expect(store.getSnapshot().checked).toBe(true)
      })
      call.mockClear()
      document.dispatchEvent(new Event('visibilitychange'))

      await vi.waitFor(() => {
        expect(call).toHaveBeenCalledWith('plugin.update.check', undefined, expect.any(AbortSignal))
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

  it('removes a terminal install result when its ten-minute display window expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const terminal = {
      schemaVersion: 1 as const,
      jobId: 'job-rollback',
      phase: 'rolled-back' as const,
      previousVersion: '0.1.3',
      targetVersion: '0.1.4',
      message: '新版本安装失败，已自动恢复旧版本。',
      updatedAtMillis: 1_000_000,
    }
    let installStatusReads = 0
    const store = new ArkmePluginUpdateStore((async (operation: string) => {
      if (operation !== 'plugin.update.install-status') return updateStatus()
      installStatusReads += 1
      return installStatusReads === 1 ? terminal : undefined
    }) as never)
    try {
      await store.refreshInstallStatus(false)
      expect(store.getSnapshot().install).toEqual(terminal)

      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1)

      expect(store.getSnapshot().install).toBeUndefined()
    } finally {
      store.stop()
      vi.useRealTimers()
    }
  })
})
