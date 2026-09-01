import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import type { ArkmeDirectoryEntryOwnerProps } from '../src/client/slots-contract.js'

const testState = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: testState.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {},
}))
vi.mock('../src/client/ArkmeNotificationPermissionBanner.js', () => ({
  ArkmeNotificationPermissionBanner: () => null,
}))
vi.mock('../src/client/ArkmeDSHBetaCommunityEntry.js', () => ({
  ArkmeDSHBetaCommunityEntry: () => null,
  ArkmeDSHBetaCommunityEntryContent: () => null,
}))
vi.mock('../src/client/arko-conversation-preview-sync.js', () => ({
  ArkmeArkoConversationPreviewSync: class ArkmeArkoConversationPreviewSync {
    start() { return () => undefined }
  },
}))

import { ArkmeNavigation } from '../src/client/ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeNotificationActivation } from '../src/client/notification-activation-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const targetSource: ArkmeSourceItem = {
  sourceRef: 'notification-target-ref',
  sourceKey: 'notification-target-key',
  kind: 'private_chat',
  displayName: '通知目标会话',
  activeAtMillis: 100,
  unreadCount: 1,
  latestSequence: 10,
}

let renderer: ReactTestRenderer | undefined

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    setTimeout,
    clearTimeout,
  })
  testState.callArkme.mockReset()
  testState.callArkme.mockImplementation(async (operation: string) => {
    if (operation === 'sources.list') {
      return { directory: 'root', items: [targetSource], hasMore: false }
    }
    if (operation === 'bots.private-chat.directory') return { items: [] }
    if (operation === 'chat.official-author.profile' || operation === 'arko.profile') {
      throw new Error('not needed by this navigation test')
    }
    return {}
  })

  const activation = arkmeNotificationActivation.getSnapshot()
  arkmeNotificationActivation.consume(activation.revision)
  arkmeChatDirectory.activateAccount('test:notification-activation-navigation')
  arkmeChatDirectory.publish([targetSource])
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001 })
  arkmeUi.selectSource(targetSource)
})

afterEach(() => {
  renderer?.unmount()
  renderer = undefined
  arkmeChatDirectory.activateAccount(undefined)
  const activation = arkmeNotificationActivation.getSnapshot()
  arkmeNotificationActivation.consume(activation.revision)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  arkmeUi.showLogin()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('system notification navigation activation', () => {
  it('reclaims a consumer directory entry without stealing the final workspace ACK', async () => {
    let ownerProps: ArkmeDirectoryEntryOwnerProps | undefined
    const onActivateSurface = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeNavigation
        onActivateSurface={onActivateSurface}
        renderSlot={(_key, props) => {
          ownerProps = props
          return <div data-active-entry={props.activeEntryId} />
        }}
      />)
      await Promise.resolve()
    })
    await flushEffects()

    act(() => { ownerProps?.activateEntry('consumer-entry') })
    expect(ownerProps?.activeEntryId).toBe('consumer-entry')

    const consume = vi.spyOn(arkmeNotificationActivation, 'consume')
    act(() => { arkmeNotificationActivation.publish(targetSource) })
    await flushEffects()

    expect(ownerProps?.activeEntryId).toBeUndefined()
    expect(arkmeUi.getSnapshot()).toMatchObject({
      mode: 'source',
      selectedSource: targetSource,
    })
    expect(consume).not.toHaveBeenCalled()
    expect(arkmeNotificationActivation.getSnapshot().source).toEqual(targetSource)
    expect(arkmeNotificationActivation.getSnapshot().navigationApplied).toBe(true)
    expect(arkmeNotificationActivation.getSnapshot().surfaceCommitted).toBe(false)
    expect(onActivateSurface).toHaveBeenCalledOnce()

    const committedUiRevision = arkmeUi.getSnapshot().notificationActivationRevision ?? 0
    act(() => { arkmeUi.showHarness() })
    await flushEffects()
    expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: targetSource })
    expect(arkmeUi.getSnapshot().notificationActivationRevision).toBeGreaterThan(committedUiRevision)
    expect(onActivateSurface).toHaveBeenCalledTimes(2)
  })

  it('waits for an in-flight author navigation and reasserts the notification target before commit', async () => {
    const authorSource: ArkmeSourceItem = {
      sourceRef: 'author-source-ref', sourceKey: 'author-source-key', kind: 'private_chat',
      displayName: '作者', activeAtMillis: 101, unreadCount: 0, peerUserId: 11,
    }
    let resolveAuthor: ((value: { source: ArkmeSourceItem }) => void) | undefined
    const authorOpening = new Promise<{ source: ArkmeSourceItem }>(resolve => { resolveAuthor = resolve })
    testState.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'sources.list') return { directory: 'root', items: [targetSource], hasMore: false }
      if (operation === 'bots.private-chat.directory') return { items: [] }
      if (operation === 'chat.official-author.private.open') return await authorOpening
      if (operation === 'chat.official-author.profile' || operation === 'arko.profile') {
        throw new Error('not needed by this navigation test')
      }
      return {}
    })

    await act(async () => {
      renderer = create(<ArkmeNavigation />)
      await Promise.resolve()
    })
    await flushEffects()
    const authorButton = renderer.root.findAllByType('button')
      .find(button => button.props['aria-label'] === '联系作者')
    expect(authorButton).toBeDefined()

    act(() => { authorButton?.props.onClick() })
    await flushEffects()
    expect(testState.callArkme).toHaveBeenCalledWith('chat.official-author.private.open')

    act(() => { arkmeNotificationActivation.publish('activation-author-race', targetSource) })
    await flushEffects()
    expect(arkmeNotificationActivation.getSnapshot()).toMatchObject({
      activationId: 'activation-author-race', navigationApplied: false,
    })

    await act(async () => {
      resolveAuthor?.({ source: authorSource })
      await authorOpening
      await Promise.resolve()
    })
    await flushEffects()

    expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: targetSource })
    expect(arkmeNotificationActivation.getSnapshot()).toMatchObject({
      activationId: 'activation-author-race', navigationApplied: true, surfaceCommitted: false,
    })
  })
})
