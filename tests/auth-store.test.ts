import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeAuthSnapshot, ArkmeClientConfig } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))

import { callArkme } from '../src/client/api.js'
import { ArkmeAuthStore } from '../src/client/auth-store.js'

const config: ArkmeClientConfig = {
  captchaId: 'captcha-id',
  environment: 'prod',
  testLoginEnabled: false,
  jiwoScanLoginEnabled: false,
  callAssetBasePath: '/arkme-self/api/call',
  voiceprintEnrollmentPath: '/voiceprint',
  recordingImportPath: '/arkme-self/api/recording/import',
  mediaPath: '/arkme-self/api/media',
  shareWebsite: 'https://app.arkme.ai',
  recordingWorkbenchV2Enabled: true,
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

describe('ArkmeAuthStore', () => {
  beforeEach(() => { vi.mocked(callArkme).mockReset() })

  it('does not let a stale auth refresh replace a newer pending QR login', async () => {
    const statusResponse = deferred<ArkmeAuthSnapshot>()
    vi.mocked(callArkme).mockImplementation(async method => {
      if (method === 'auth.status') return await statusResponse.promise
      if (method === 'auth.config') return config
      throw new Error(`unexpected method ${method}`)
    })
    const store = new ArkmeAuthStore()
    const refresh = store.refresh()
    const pending: ArkmeAuthSnapshot = {
      status: 'pending',
      environment: 'prod',
      attemptId: 'fresh-attempt',
      qrContent: 'weixin://fresh-qr',
      expiresAtMillis: 1_800_000_000_000,
    }

    store.setAuth(pending)
    statusResponse.resolve({ status: 'logged-out', environment: 'prod' })

    await expect(refresh).resolves.toEqual(pending)
    expect(store.getSnapshot().auth).toEqual(pending)
    expect(store.getSnapshot().config).toEqual(config)
    expect(store.getSnapshot().busy).toBe(false)
  })

  it('preserves an active pending QR login when auth refresh starts afterward', async () => {
    vi.mocked(callArkme).mockImplementation(async method => {
      if (method === 'auth.status') return { status: 'logged-out', environment: 'prod' }
      if (method === 'auth.config') return config
      throw new Error(`unexpected method ${method}`)
    })
    const store = new ArkmeAuthStore()
    const pending: ArkmeAuthSnapshot = {
      status: 'pending',
      environment: 'prod',
      attemptId: 'active-attempt',
      qrContent: 'weixin://active-qr',
      expiresAtMillis: 1_800_000_000_000,
    }
    store.setAuth(pending)

    await expect(store.refresh()).resolves.toEqual(pending)
    expect(store.getSnapshot().auth).toEqual(pending)
  })
})
