import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClientLocaleStub } from './client-locale-stub.js'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
  onActivated: vi.fn(),
  completeActivationV2: vi.fn(),
  stopActivated: vi.fn(),
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {},
}))
vi.mock('../src/client/desktop-notification-runtime.js', () => ({
  arkmeDesktopNotifications: {
    onActivated: mocks.onActivated,
    completeActivationV2: mocks.completeActivationV2,
    show: vi.fn(),
  },
}))
vi.mock('../src/client/new-session-activation.js', () => ({
  watchOfficialConversationSelection: vi.fn(() => vi.fn()),
  watchOfficialNewSession: vi.fn(() => vi.fn()),
  isOfficialConversationTarget: vi.fn(),
  isOfficialNewSessionTarget: vi.fn(),
}))

describe('client notification activation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onActivated.mockReturnValue(mocks.stopActivated)
  })

  it('resolves the opaque source through the existing directory before opening its conversation', async () => {
    const source = {
      sourceRef: 'fresh-source-ref', sourceKey: 'stable-source-key', kind: 'private_chat' as const, displayName: '林溪',
      activeAtMillis: 10, unreadCount: 1, latestSequence: 9,
    }
    mocks.callArkme.mockResolvedValue({ directory: 'root', items: [source], hasMore: false })
    const [{ apply }, { arkmeUi }, { arkmeNotificationActivation }] = await Promise.all([
      import('../src/client/index.js'),
      import('../src/client/ui-controller.js'),
      import('../src/client/notification-activation-store.js'),
    ])
    const effects: Array<{ run: () => (() => void) | void; label: string }> = []
    apply({
      slots: { inject: vi.fn(), register: vi.fn() },
      locale: createClientLocaleStub(),
      effect: (run: () => (() => void) | void, label: string) => { effects.push({ run, label }) },
    } as never)
    const activationEffect = effects.find(effect => effect.label === 'dsh-arkme: activate message notification sources')
    const cleanup = activationEffect?.run()
    const listener = mocks.onActivated.mock.calls[0]?.[0] as ((activation: {
      sourceRef: string; sourceKey?: string
    }) => void) | undefined

    listener?.({
      activationId: 'activation-resolved', kind: 'chat-source',
      sourceRef: 'signed-old-source-ref', sourceKey: 'stable-source-key',
    })

    await vi.waitFor(() => {
      expect(mocks.callArkme).toHaveBeenCalledWith('sources.list', {
        directory: 'root', limit: 50, refresh: true,
      }, expect.any(AbortSignal))
      expect(arkmeUi.getSnapshot()).toMatchObject({
        mode: 'source', selectedSource: source,
      })
      expect(arkmeNotificationActivation.getSnapshot().source).toEqual(source)
    })
    const committedRevision = arkmeUi.getSnapshot().notificationActivationRevision
    expect(committedRevision).toBeGreaterThan(0)
    expect(mocks.completeActivationV2).not.toHaveBeenCalled()
    listener?.({
      activationId: 'activation-resolved', kind: 'chat-source',
      sourceRef: 'signed-old-source-ref', sourceKey: 'stable-source-key',
    })
    await Promise.resolve()
    expect(mocks.callArkme).toHaveBeenCalledOnce()
    expect(arkmeUi.getSnapshot().notificationActivationRevision).toBe(committedRevision)
    expect(mocks.completeActivationV2).not.toHaveBeenCalled()
    cleanup?.()
    expect(mocks.stopActivated).toHaveBeenCalledOnce()
  }, 15_000)

  it('reports not-found instead of silently dropping a V2 activation miss', async () => {
    mocks.callArkme.mockResolvedValue({ directory: 'root', items: [], hasMore: false })
    const { apply } = await import('../src/client/index.js')
    const effects: Array<{ run: () => (() => void) | void; label: string }> = []
    apply({
      slots: { inject: vi.fn(), register: vi.fn() }, locale: createClientLocaleStub(),
      effect: (run: () => (() => void) | void, label: string) => { effects.push({ run, label }) },
    } as never)
    const cleanup = effects.find(effect => effect.label === 'dsh-arkme: activate message notification sources')?.run()
    const listener = mocks.onActivated.mock.calls.at(-1)?.[0] as ((activation: {
      activationId: string; kind: 'chat-source'; sourceRef: string; sourceKey?: string
    }) => void)

    listener({ activationId: 'activation-miss', kind: 'chat-source', sourceRef: 'missing-source' })

    await vi.waitFor(() => {
      expect(mocks.completeActivationV2).toHaveBeenCalledWith('activation-miss', 'not-found')
    })
    cleanup?.()
  })

  it('reports failed and superseded V2 resolution outcomes', async () => {
    let firstSignal: AbortSignal | undefined
    mocks.callArkme.mockImplementationOnce((_operation, _payload, signal: AbortSignal) => {
      firstSignal = signal
      return new Promise(() => undefined)
    }).mockRejectedValueOnce(new Error('directory unavailable'))
    const { apply } = await import('../src/client/index.js')
    const effects: Array<{ run: () => (() => void) | void; label: string }> = []
    apply({
      slots: { inject: vi.fn(), register: vi.fn() }, locale: createClientLocaleStub(),
      effect: (run: () => (() => void) | void, label: string) => { effects.push({ run, label }) },
    } as never)
    const cleanup = effects.find(effect => effect.label === 'dsh-arkme: activate message notification sources')?.run()
    const listener = mocks.onActivated.mock.calls.at(-1)?.[0] as ((activation: {
      activationId: string; kind: 'chat-source'; sourceRef: string; sourceKey?: string
    }) => void)

    listener({ activationId: 'activation-old', kind: 'chat-source', sourceRef: 'source-old' })
    listener({ activationId: 'activation-old', kind: 'chat-source', sourceRef: 'source-old' })
    expect(firstSignal?.aborted).toBe(false)
    expect(mocks.callArkme).toHaveBeenCalledOnce()
    expect(mocks.completeActivationV2).not.toHaveBeenCalledWith('activation-old', 'superseded')
    listener({ activationId: 'activation-failed', kind: 'chat-source', sourceRef: 'source-failed' })

    expect(firstSignal?.aborted).toBe(true)
    await vi.waitFor(() => {
      expect(mocks.completeActivationV2).toHaveBeenCalledWith('activation-old', 'superseded')
      expect(mocks.completeActivationV2).toHaveBeenCalledWith('activation-failed', 'failed')
    })
    cleanup?.()
  })
})
