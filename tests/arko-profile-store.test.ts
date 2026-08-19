import { describe, expect, it, vi } from 'vitest'
import {
  arkoPresentationName, ArkmeArkoProfileStore,
} from '../src/client/arko-profile-store.js'

describe('Arko profile presentation', () => {
  it('maps only the cloud version-zero Agent default to Arko', () => {
    expect(arkoPresentationName({ displayName: 'Agent', version: 0 })).toBe('Arko')
    expect(arkoPresentationName({ displayName: 'Agent', version: 2 })).toBe('Agent')
    expect(arkoPresentationName({ displayName: '小可', version: 2 })).toBe('小可')
  })

  it('publishes renamed profiles to every mounted presentation surface', () => {
    const store = new ArkmeArkoProfileStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.activateUser(10001)
    store.setProfile(10001, { displayName: 'Agent', version: 0 })
    store.setProfile(10001, { displayName: '小可', version: 1 })

    expect(store.getSnapshot()).toMatchObject({
      userId: 10001,
      profile: { displayName: '小可', version: 1 },
    })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('drops the previous account profile and ignores its late response', () => {
    const store = new ArkmeArkoProfileStore()
    store.activateUser(10001)
    store.setProfile(10001, { displayName: '旧账号名称', version: 3 })
    store.activateUser(10002)
    store.setProfile(10001, { displayName: '迟到名称', version: 4 })

    expect(store.getSnapshot()).toEqual({ revision: 3, userId: 10002 })
  })

  it('does not let an older same-account response roll back a renamed profile', () => {
    const store = new ArkmeArkoProfileStore()
    store.activateUser(10001)
    store.setProfile(10001, { displayName: '小可', version: 3 })
    store.setProfile(10001, { displayName: '旧名称', version: 2 })
    store.setProfile(10001, { displayName: '冲突名称', version: 3 })

    expect(store.getSnapshot()).toMatchObject({
      userId: 10001,
      profile: { displayName: '小可', version: 3 },
    })
  })
})
