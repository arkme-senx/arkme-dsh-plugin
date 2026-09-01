import { describe, expect, it, vi } from 'vitest'
import { installArkmeSkinMarketBridge } from '../src/client/skin-market-bridge.js'

describe('skin market bridge', () => {
  function installWithState(state: unknown) {
    const documentRef = { body: { dataset: {} } } as unknown as Document
    const windowRef = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    }
    vi.stubGlobal('window', windowRef)
    const fetchRef = vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })) as unknown as typeof fetch
    const dispose = installArkmeSkinMarketBridge(documentRef, fetchRef)
    return { dispose, documentRef }
  }

  it.each(['active', 'restart-required'])('mirrors a selected QQ2006 skin in %s state', async (activation) => {
    const { dispose, documentRef } = installWithState({
      skins: [{
        skinId: 'laplaceyoung.dsh-qq2006',
        installation: 'installed',
        activation,
        primary: true,
      }],
    })
    await vi.waitFor(() => expect(documentRef.body.dataset.arkmeSkin).toBe('qq2006'))

    dispose()
    expect(documentRef.body.dataset.arkmeSkin).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('keeps the default Arkme theme when QQ2006 is not selected', async () => {
    const { dispose, documentRef } = installWithState({
      skins: [{
        skinId: 'laplaceyoung.dsh-qq2006',
        installation: 'installed',
        activation: 'inactive',
        primary: false,
      }],
    })

    await vi.waitFor(() => expect(documentRef.body.dataset.arkmeSkin).toBeUndefined())
    dispose()
    vi.unstubAllGlobals()
  })
})
