import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from '../src/client/app-update-store.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function snapshot(status: ArkmeAppUpdateSnapshot['status'], patch: Partial<ArkmeAppUpdateSnapshot> = {}): ArkmeAppUpdateSnapshot {
  return { status, currentVersion: '1.2.0', currentVersionCode: 12, canAutoInstall: true, ...patch }
}

describe('ArkmeAppUpdateStore', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('uses a change event that wins the race with the initial status request', async () => {
    const initial = deferred<ArkmeAppUpdateSnapshot | null>()
    let emit!: (state: ArkmeAppUpdateSnapshot | null) => void
    vi.stubGlobal('arkmeDesktop', {
      appUpdateUi: true,
      appVersion: '1.2.0',
      update: Object.freeze({
        status: vi.fn(() => initial.promise),
        onChanged: vi.fn((listener: typeof emit) => { emit = listener; return vi.fn() }),
        open: vi.fn(async () => true),
      }),
    })
    const store = new ArkmeAppUpdateStore()
    const stop = store.start()
    const changed = snapshot('downloading', {
      latestVersion: '1.3.0', latestVersionCode: 13, downloadedBytes: 512, totalBytes: 1_024,
    })

    emit(changed)
    initial.resolve(snapshot('idle'))
    await initial.promise
    await Promise.resolve()

    expect(store.getSnapshot()).toEqual({ status: changed, error: '' })
    stop()
  })

  it('ignores initial status and change events after its owner unmounts', async () => {
    const initial = deferred<ArkmeAppUpdateSnapshot | null>()
    const unsubscribe = vi.fn()
    let emit!: (state: ArkmeAppUpdateSnapshot | null) => void
    vi.stubGlobal('arkmeDesktop', {
      appUpdateUi: true,
      appVersion: '1.2.0',
      update: Object.freeze({
        status: vi.fn(() => initial.promise),
        onChanged: vi.fn((listener: typeof emit) => { emit = listener; return unsubscribe }),
        open: vi.fn(async () => true),
      }),
    })
    const store = new ArkmeAppUpdateStore()
    const stop = store.start()

    stop()
    emit(snapshot('available', { latestVersion: '1.3.0', latestVersionCode: 13 }))
    initial.resolve(snapshot('current', { noUpdateAvailable: true }))
    await initial.promise
    await Promise.resolve()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toEqual({ error: '' })
  })

  it('reads state and opens the shell-owned update UI without calling legacy actions', async () => {
    const current = snapshot('available', { latestVersion: '1.3.0', latestVersionCode: 13 })
    const legacy = {
      check: vi.fn(), download: vi.fn(), install: vi.fn(), showInFolder: vi.fn(),
    }
    const open = vi.fn(async () => true)
    const status = vi.fn(async () => current)
    vi.stubGlobal('arkmeDesktop', {
      appUpdateUi: true,
      appVersion: '1.2.0',
      update: Object.freeze({ status, onChanged: vi.fn(() => vi.fn()), open, ...legacy }),
    })
    const store = new ArkmeAppUpdateStore()
    const stop = store.start()
    await vi.waitFor(() => expect(store.getSnapshot().status).toEqual(current))

    await expect(store.open()).resolves.toBe(true)

    expect(status).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
    expect(legacy.check).not.toHaveBeenCalled()
    expect(legacy.download).not.toHaveBeenCalled()
    expect(legacy.install).not.toHaveBeenCalled()
    expect(legacy.showInFolder).not.toHaveBeenCalled()
    stop()
  })

  it('asks for a client upgrade when the shell-owned capability is missing', async () => {
    const status = vi.fn()
    const open = vi.fn()
    vi.stubGlobal('arkmeDesktop', {
      appUpdateUi: false,
      appVersion: '1.2.0',
      update: Object.freeze({ status, onChanged: vi.fn(() => vi.fn()), open }),
    })
    const store = new ArkmeAppUpdateStore()

    const stop = store.start()
    await expect(store.open()).resolves.toBe(false)

    expect(store.getSnapshot()).toEqual({ error: '请升级 Arkme 客户端' })
    expect(status).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    stop()
  })
})
