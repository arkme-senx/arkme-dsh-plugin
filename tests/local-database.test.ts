import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import type { ArkmePendingWrite, ArkmeSelfRecordItem, ArkmeUserProfile } from '../src/types.js'

function pending(recordUid: string, textContent: string): ArkmePendingWrite {
  return {
    recordUid,
    textContent,
    createdAtMillis: 100,
    sendAtMillis: 100,
    attempts: 0,
  }
}

function remote(recordUid: string, textContent: string): ArkmeSelfRecordItem {
  return {
    recordUid,
    sendAtMillis: 200,
    title: '',
    textContent,
    templateKind: 1,
    status: 1,
    version: 2,
  }
}

describe('ArkmeLocalDatabase', () => {
  it('migrates legacy outbox data and isolates cached records by account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-arkme-db-'))
    const legacy = new ArkmeStateStore(directory)
    await legacy.putPending(10001, pending('pending-1', 'offline'))
    const database = new ArkmeLocalDatabase(directory, legacy)

    const first = await database.cachedSnapshot(10001)
    expect(first.items).toMatchObject([{
      recordUid: 'pending-1', textContent: 'offline', localState: 'pending',
    }])
    expect(first.revision).toBeGreaterThan(0)
    expect(await legacy.listPending(10001)).toEqual([])
    expect((await database.cachedSnapshot(10002)).items).toEqual([])

    const mode = (await stat(join(directory, 'records.sqlite3'))).mode & 0o777
    expect(mode).toBe(0o600)
    database.close()
  })

  it('persists remote pages, summary metadata, and pending sync transitions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-arkme-db-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const userId = 10001

    await database.cacheSummary(userId, { recordCount: 7, wordsCount: 12, totalSec: 3 })
    await database.cachePage(userId, {
      items: [remote('server-1', 'server')],
      hasMore: true,
      nextCursor: { sendAtMillis: 199, recordUid: 'next' },
    })
    await database.putPending(userId, pending('local-1', 'local first'))

    const cached = await database.cachedSnapshot(userId)
    expect(cached.summary).toEqual({ recordCount: 7, wordsCount: 12, totalSec: 3 })
    expect(cached.nextCursor).toEqual({ sendAtMillis: 199, recordUid: 'next' })
    expect(cached.items.map(item => [item.recordUid, item.localState])).toEqual([
      ['server-1', 'synced'],
      ['local-1', 'pending'],
    ])
    const revisionAfterSeed = cached.revision

    await database.markAttempt(userId, 'local-1', 'network down')
    const revisionAfterFailure = await database.revision(userId)
    expect(revisionAfterFailure).toBeGreaterThan(revisionAfterSeed)
    expect(await database.listPending(userId)).toMatchObject([{
      recordUid: 'local-1', attempts: 1, lastError: 'network down',
    }])
    await database.markSynced(userId, 'local-1', 1)
    expect(await database.revision(userId)).toBeGreaterThan(revisionAfterFailure)
    expect(await database.listPending(userId)).toEqual([])
    expect((await database.cachedSnapshot(userId)).items.find(item => item.recordUid === 'local-1'))
      .toMatchObject({ status: 1, localState: 'synced' })

    const search = await database.queryCached(userId, { query: 'server', limit: 10 })
    expect(search.items.map(item => item.recordUid)).toEqual(['server-1'])
    expect(search.cacheComplete).toBe(false)
    expect((await database.queryCached(10002, { query: 'server', limit: 10 })).items).toEqual([])

    await database.cachePage(userId, { items: [], hasMore: false }, { sendAtMillis: 199, recordUid: 'next' })
    expect((await database.queryCached(userId, { limit: 10 })).cacheComplete).toBe(true)

    const profile: ArkmeUserProfile = {
      userId,
      displayName: '测试用户',
      nickname: '测试用户',
      avatarRef: 'avatar-file-id',
      arkmeId: 'arkme-id',
      accountType: 1,
      createdAt: 123,
      bindings: { apple: true, wechat: false, google: true },
      contact: { phoneMasked: '138****0000', emailMasked: 't***@example.com' },
    }
    const profileBefore = await database.revision(userId)
    const cachedProfile = await database.cacheProfile(userId, profile)
    expect(cachedProfile.profile).toEqual(profile)
    expect(cachedProfile.revision).toBeGreaterThan(profileBefore)
    expect((await database.cachedProfile(10002)).profile).toBeNull()
    database.close()
  })
})
