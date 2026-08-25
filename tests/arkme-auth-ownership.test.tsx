import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeAuthSnapshot } from '../src/types.js'

const testState = vi.hoisted(() => ({
  calls: [] as string[],
  pending: {
    status: 'pending',
    environment: 'prod',
    attemptId: 'gate-attempt',
    qrContent: 'weixin://gate-qr',
    expiresAtMillis: 1_800_000_000_000,
  } as ArkmeAuthSnapshot,
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: vi.fn(async (method: string) => {
    testState.calls.push(method)
    if (method === 'auth.poll') return testState.pending
    throw new Error(`unexpected method ${method}`)
  }),
}))

import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

describe('Arkme WeChat login ownership', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    testState.calls = []
    arkmeAuthStore.setAuth(testState.pending)
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    vi.useRealTimers()
  })

  it('does not poll the startup gate attempt from a hidden non-owner surface', async () => {
    await act(async () => {
      renderer = create(<ArkmeSurface ownsWechatLogin={false} />)
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(testState.calls.filter(method => method === 'auth.poll')).toHaveLength(0)
  })
})
