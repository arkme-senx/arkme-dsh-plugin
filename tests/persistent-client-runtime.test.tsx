import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/ArkmeOutgoingCallHost.js', () => ({ ArkmeOutgoingCallHost: () => null }))
vi.mock('../src/client/realtime-client-events.js', () => ({ useArkmeRealtimeClientEvents: () => undefined }))

import { ArkmePersistentClientRuntime } from '../src/client/ArkmePersistentShell.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('Arkme persistent client runtime', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })
    arkmeUi.showLogin()
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    arkmeUi.showConversations()
  })

  it('recovers the normal Web workspace if shared authentication completes after the login dialog unmounts', async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10002 })
    arkmeUi.openWebLoginDialog()

    await act(async () => {
      renderer = create(<ArkmePersistentClientRuntime />)
      await Promise.resolve()
    })

    expect(arkmeUi.getSnapshot().mode).toBe('harness')
    expect(arkmeUi.getSnapshot().webLoginDialogOpen).toBeUndefined()
  })
})
