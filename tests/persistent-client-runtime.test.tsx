import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/ArkmeOutgoingCallHost.js', () => ({ ArkmeOutgoingCallHost: () => null }))
vi.mock('../src/client/realtime-client-events.js', () => ({ useArkmeRealtimeClientEvents: () => undefined }))

import { ArkmePersistentClientRuntime } from '../src/client/ArkmePersistentShell.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
import { arkmePresentationMaintenance } from '../src/client/presentation-maintenance-runtime.js'
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
    vi.restoreAllMocks()
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

  it('owns avatar account scope and maintenance independently from optional navigation surfaces', async () => {
    const activateScope = vi.spyOn(arkmeAvatarImages, 'activateScope')
    const stopMaintenance = vi.fn()
    const startMaintenance = vi.spyOn(arkmePresentationMaintenance, 'start').mockReturnValue(stopMaintenance)
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10002 })

    await act(async () => { renderer = create(<ArkmePersistentClientRuntime />) })
    expect(activateScope).toHaveBeenLastCalledWith('prod:10002')
    expect(startMaintenance).toHaveBeenCalledOnce()

    await act(async () => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10002 })
    })
    expect(stopMaintenance).toHaveBeenCalledOnce()
    expect(activateScope).toHaveBeenLastCalledWith('test:10002')
    expect(startMaintenance).toHaveBeenCalledTimes(2)

    await act(async () => {
      arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    })
    expect(stopMaintenance).toHaveBeenCalledTimes(2)
    expect(activateScope).toHaveBeenLastCalledWith(undefined)
  })
})
