import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeAppUpdateStore } from '../src/client/app-update-store.js'

describe('ArkmeAppUpdateStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps reading desktop status until a background check reaches a terminal state', async () => {
    vi.useFakeTimers()
    const status = vi.fn()
      .mockResolvedValueOnce({ status: 'checking', currentVersion: '1.2.0' })
      .mockResolvedValueOnce({ status: 'available', currentVersion: '1.2.0', latestVersion: '1.3.0' })
    vi.stubGlobal('arkmeDesktop', {
      update: {
        status,
        check: vi.fn().mockResolvedValue({ status: 'checking', currentVersion: '1.2.0' }),
        download: vi.fn(),
        showInFolder: vi.fn(),
      },
    })
    const store = new ArkmeAppUpdateStore()
    const stop = store.start()

    await vi.waitFor(() => expect(store.getSnapshot().status?.status).toBe('checking'))
    await vi.advanceTimersByTimeAsync(1_000)

    await vi.waitFor(() => expect(store.getSnapshot().status?.status).toBe('available'))
    expect(store.getSnapshot().status).toMatchObject({ status: 'available', latestVersion: '1.3.0' })
    expect(status).toHaveBeenCalledTimes(2)
    stop()
  })

  it('checks for an app update once when the client starts', async () => {
    const check = vi.fn().mockResolvedValue({
      status: 'available',
      currentVersion: '1.2.0',
      latestVersion: '1.3.0',
      releaseNotes: '修复更新体验',
    })
    vi.stubGlobal('arkmeDesktop', {
      update: {
        status: vi.fn().mockResolvedValue(null),
        check,
        download: vi.fn(),
        showInFolder: vi.fn(),
      },
    })
    const store = new ArkmeAppUpdateStore()
    const stop = store.start()

    await vi.waitFor(() => expect(store.getSnapshot().status?.status).toBe('available'))
    expect(check).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().status).toMatchObject({
      latestVersion: '1.3.0',
      releaseNotes: '修复更新体验',
    })
    stop()
  })

  it('enters downloading state immediately so status polling can report byte progress', async () => {
    let finishDownload: ((status: { status: 'downloaded', currentVersion: string, latestVersion: string }) => void) | undefined
    vi.stubGlobal('arkmeDesktop', {
      update: {
        status: vi.fn().mockResolvedValue(null),
        check: vi.fn(),
        download: vi.fn().mockImplementation(async () => await new Promise(resolve => { finishDownload = resolve })),
        showInFolder: vi.fn(),
      },
    })
    const store = new ArkmeAppUpdateStore()
    const task = store.download()

    expect(store.getSnapshot().status).toMatchObject({ status: 'downloading', downloadedBytes: 0 })
    finishDownload?.({ status: 'downloaded', currentVersion: '1.2.0', latestVersion: '1.3.0' })
    await task
  })
})
