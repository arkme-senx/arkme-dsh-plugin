import { describe, expect, it } from 'vitest'
import { ArkmeDirectoryWorkspaceController } from '../src/client/redesign/contacts/directory-workspace-controller.js'
import type { ArkmeSourceItem } from '../src/types.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

const botSource: ArkmeSourceItem = {
  sourceRef: 'bot-source', kind: 'private_chat', displayName: 'Bot', activeAtMillis: 1, unreadCount: 0,
}

describe('ArkmeDirectoryWorkspaceController context gating', () => {
  it('derives Logo for a first authenticated context and native mode for a later session before effects run', () => {
    const controller = new ArkmeDirectoryWorkspaceController()

    expect(controller.getSnapshotForContext('account-a', 'session-1')).toMatchObject({
      directoryMode: true, selection: { kind: 'none' },
    })
    expect(controller.getSnapshotForContext('account-a', 'session-1').sourceActivationRequest).toBeUndefined()
    controller.activateContext('account-a', 'session-1')
    expect(controller.getSnapshotForContext('account-a', 'session-1').directoryMode).toBe(true)
    expect(controller.getSnapshotForContext('account-a', 'session-2').directoryMode).toBe(false)
  })

  it('synchronously gates an unconsumed group request from a new session context', () => {
    const controller = new ArkmeDirectoryWorkspaceController()
    controller.activateContext('account-a', 'session-1')
    controller.openGroup('group-source')

    expect(controller.getSnapshotForContext('account-a', 'session-1').sourceActivationRequest)
      .toMatchObject({ sourceRef: 'group-source' })
    expect(controller.getSnapshotForContext('account-a', 'session-2').sourceActivationRequest).toBeUndefined()
  })

  it('gates a deferred Bot completion and error from session and account changes before passive cleanup', async () => {
    const first = deferred<ArkmeSourceItem>()
    const second = deferred<ArkmeSourceItem>()
    let call = 0
    const controller = new ArkmeDirectoryWorkspaceController(async () => await (++call === 1 ? first.promise : second.promise))
    controller.activateContext('account-a', 'session-1')
    controller.openBot('bot-a')

    first.resolve(botSource)
    await Promise.resolve()
    expect(controller.getSnapshotForContext('account-a', 'session-2').sourceActivationRequest).toBeUndefined()

    controller.activateContext('account-a', 'session-2')
    controller.openBot('bot-b')
    second.reject(new Error('stale failure'))
    await Promise.resolve()
    expect(controller.getSnapshotForContext('account-b', 'session-2').botActivationFailure).toBeUndefined()
  })

  it('keeps explicit directory intent above passive navigation reconciliation but honors an explicit native click', () => {
    const controller = new ArkmeDirectoryWorkspaceController()
    controller.activateContext('account-a', 'session-1')
    controller.select({ kind: 'contact', contactRef: 'contact-a' })

    expect(controller.activateNativeSurface({ passive: true })).toBe(false)
    expect(controller.getSnapshotForContext('account-a', 'session-1').selection)
      .toEqual({ kind: 'contact', contactRef: 'contact-a' })
    expect(controller.activateNativeSurface()).toBe(true)
    expect(controller.getSnapshotForContext('account-a', 'session-1')).toMatchObject({
      directoryMode: false, selection: { kind: 'none' }, mobileView: 'content',
    })
  })
})
