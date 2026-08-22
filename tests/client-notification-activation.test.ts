import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
  onActivated: vi.fn(),
  stopActivated: vi.fn(),
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {},
}))
vi.mock('../src/client/desktop-notification-runtime.js', () => ({
  arkmeDesktopNotifications: { onActivated: mocks.onActivated, show: vi.fn() },
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
      effect: (run: () => (() => void) | void, label: string) => { effects.push({ run, label }) },
    } as never)
    const activationEffect = effects.find(effect => effect.label === 'dsh-arkme: activate message notification sources')
    const cleanup = activationEffect?.run()
    const listener = mocks.onActivated.mock.calls[0]?.[0] as ((activation: {
      sourceRef: string; sourceKey?: string
    }) => void) | undefined

    listener?.({ sourceRef: 'signed-old-source-ref', sourceKey: 'stable-source-key' })

    await vi.waitFor(() => {
      expect(mocks.callArkme).toHaveBeenCalledWith('sources.list', {
        directory: 'root', limit: 50, refresh: true,
      }, expect.any(AbortSignal))
      expect(arkmeUi.getSnapshot()).toMatchObject({
        mode: 'source', selectedSource: source,
      })
      expect(arkmeNotificationActivation.getSnapshot().source).toEqual(source)
    })
    cleanup?.()
    expect(mocks.stopActivated).toHaveBeenCalledOnce()
  })
})
