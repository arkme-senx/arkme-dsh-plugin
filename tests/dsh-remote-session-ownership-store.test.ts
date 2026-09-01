import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DshRemoteSessionOwnershipStore } from '../src/dsh-remote/session-ownership-store.js'

describe('DSH Remote local Session ownership', () => {
  it('claims existing Sessions for the first logged-in account and never transfers them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-session-ownership-'))
    const store = new DshRemoteSessionOwnershipStore(directory, 'web')

    await expect(store.claimUnownedAndListOwned({
      accountId: 'account-a',
      sessionRefs: ['session-1', 'session-2'],
      origin: 'existing-at-login',
      nowMillis: 1_000,
    })).resolves.toEqual(new Set(['session-1', 'session-2']))

    await expect(store.claimUnownedAndListOwned({
      accountId: 'account-b',
      sessionRefs: ['session-1', 'session-3'],
      origin: 'existing-at-login',
      nowMillis: 2_000,
    })).resolves.toEqual(new Set(['session-3']))
    await expect(store.ownerAccountId('session-1')).resolves.toBe('account-a')
    await expect(store.ownerAccountId('session-3')).resolves.toBe('account-b')
  })

  it('persists implicit ownership across plugin restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-session-ownership-'))
    const first = new DshRemoteSessionOwnershipStore(directory, 'profile with spaces')
    await first.claimUnownedAndListOwned({
      accountId: 'account-a',
      sessionRefs: ['created-session'],
      origin: 'remote-create',
      nowMillis: 1_000,
    })

    const reopened = new DshRemoteSessionOwnershipStore(directory, 'profile with spaces')
    await expect(reopened.listOwned('account-a', ['created-session'])).resolves
      .toEqual(new Set(['created-session']))
    await expect(reopened.listOwned('account-b', ['created-session'])).resolves
      .toEqual(new Set())
  })
})
