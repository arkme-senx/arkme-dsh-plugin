import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import type { ArkmePendingWrite, ArkmeSelfRecordItem, ArkmeUserProfile } from '../src/types.js'
import type { ArkmeExtensionReviewOperation } from '../src/extensions/types.js'
import { expectPrivatePath } from './helpers/private-path.js'

function pending(recordUid: string, textContent: string): ArkmePendingWrite {
  return {
    recordUid,
    textContent,
    createdAtMillis: 100,
    sendAtMillis: 100,
    attempts: 0,
  }
}

function capturedPending(recordUid: string, textContent: string): ArkmePendingWrite {
  return {
    ...pending(recordUid, textContent),
    recordDurationMillis: 3_400,
    captureContext: {
      clientName: 'Google Chrome（DeepSeek Harness）', networkName: '网络已连接', electric: 100, charge: 1,
    },
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
  it('persists speaker candidates across database reopen and isolates environment, account and signing identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-speaker-cache-'))
    let database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const rows = [{ optionKey: 'key', speakerRef: 'ref', label: '甲', kind: 'speaker' as const, isCurrentUser: false }]
    await database.writeRecordingSpeakerCache('test:key-v1', 42, rows)
    await database.recordRecentEmoji('test:42', 'joy_face')
    database.close()
    database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    try {
      expect(await database.readRecordingSpeakerCache('test:key-v1', 42)).toEqual(rows)
      expect(await database.recentEmojiIds('test:42')).toEqual(['joy_face'])
      expect(await database.readRecordingSpeakerCache('production:key-v1', 42)).toBeUndefined()
      expect(await database.readRecordingSpeakerCache('test:key-v2', 42)).toBeUndefined()
      expect(await database.readRecordingSpeakerCache('test:key-v1', 43)).toBeUndefined()
      await database.writeRecordingSpeakerCache('test:key-v1', 42, [])
      expect(await database.readRecordingSpeakerCache('test:key-v1', 42)).toEqual([])
      await database.clearRecordingSpeakerCache('test:key-v1', 42)
      expect(await database.recentEmojiIds('test:42')).toEqual(['joy_face'])
      expect(await database.readRecordingSpeakerCache('test:key-v1', 42)).toBeUndefined()
    } finally { database.close() }
  })

  it('treats corrupted or structurally invalid persisted candidates as a cache miss', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-speaker-corrupt-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const raw = new DatabaseSync(join(directory, 'records.sqlite3'))
    try {
      for (const payload of ['{', '{}', '[null]', '[{"optionKey":"key"}]']) {
        raw.prepare('INSERT OR REPLACE INTO recording_speaker_cache VALUES (?, ?, ?)').run('test:key', 42, payload)
        expect(await database.readRecordingSpeakerCache('test:key', 42)).toBeUndefined()
      }
    } finally { raw.close(); database.close() }
  })

  it('adds Arkme ID change availability to an existing profile cache without dropping data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-arkme-db-'))
    const legacyDatabase = new DatabaseSync(join(directory, 'records.sqlite3'))
    legacyDatabase.exec(`
      CREATE TABLE user_profile_cache (
        user_id INTEGER PRIMARY KEY,
        display_name TEXT NOT NULL,
        nickname TEXT NOT NULL,
        avatar_ref TEXT NOT NULL,
        avatar_url TEXT,
        arkme_id TEXT NOT NULL,
        account_type INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        bind_apple INTEGER NOT NULL,
        bind_wechat INTEGER NOT NULL,
        bind_google INTEGER NOT NULL,
        phone_masked TEXT,
        email_masked TEXT,
        updated_at_millis INTEGER NOT NULL
      );
      INSERT INTO user_profile_cache VALUES (
        10001, '旧用户', '旧用户', '', NULL, 'legacy-id', 1, 123, 0, 1, 0, NULL, NULL, 456
      );
    `)
    legacyDatabase.close()

    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    expect(await database.cachedProfile(10001)).toMatchObject({
      profile: { displayName: '旧用户', arkmeId: 'legacy-id' },
    })
    expect((await database.cachedProfile(10001)).profile).not.toHaveProperty('canUpdateArkmeId')

    const previous = (await database.cachedProfile(10001)).profile!
    await database.cacheProfile(10001, { ...previous, canUpdateArkmeId: false })
    expect(await database.cachedProfile(10001)).toMatchObject({
      profile: { displayName: '旧用户', arkmeId: 'legacy-id', canUpdateArkmeId: false },
    })
    database.close()
  })

  it('migrates legacy outbox data and isolates cached records by account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-arkme-db-'))
    const legacyWriter = new ArkmeStateStore(directory)
    await legacyWriter.putPending(10001, capturedPending('pending-1', 'offline'))
    const legacy = new ArkmeStateStore(directory)
    const database = new ArkmeLocalDatabase(directory, legacy)

    const first = await database.cachedSnapshot(10001)
    expect(first.items).toMatchObject([{
      recordUid: 'pending-1', textContent: 'offline', localState: 'pending',
    }])
    expect(first.revision).toBeGreaterThan(0)
    expect(await database.listPending(10001)).toMatchObject([{
      recordUid: 'pending-1', recordDurationMillis: 3_400,
      captureContext: {
        clientName: 'Google Chrome（DeepSeek Harness）', networkName: '网络已连接', electric: 100, charge: 1,
      },
    }])
    expect(await legacy.listPending(10001)).toEqual([])
    expect((await database.cachedSnapshot(10002)).items).toEqual([])

    expectPrivatePath(join(directory, 'records.sqlite3'), 0o600)
    database.close()
  })

  it('keeps capture metadata when a pending write is reopened from SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-arkme-db-'))
    const first = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    await first.putPending(10001, capturedPending('pending-capture', 'browser metadata'))
    first.close()

    const reopened = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    expect(await reopened.listPending(10001)).toMatchObject([{
      recordUid: 'pending-capture', recordDurationMillis: 3_400,
      captureContext: {
        clientName: 'Google Chrome（DeepSeek Harness）', networkName: '网络已连接', electric: 100, charge: 1,
      },
    }])
    reopened.close()
  })

  it('upgrades an existing record outbox before writing capture metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-arkme-db-'))
    const legacyDatabase = new DatabaseSync(join(directory, 'records.sqlite3'))
    legacyDatabase.exec(`
      CREATE TABLE record_cache (
        user_id INTEGER NOT NULL,
        record_uid TEXT NOT NULL,
        send_at_millis INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        text_content TEXT NOT NULL DEFAULT '',
        template_kind INTEGER NOT NULL DEFAULT 0,
        status INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        sync_state TEXT NOT NULL CHECK (sync_state IN ('synced', 'pending', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at_millis INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL,
        PRIMARY KEY (user_id, record_uid)
      );
      INSERT INTO record_cache VALUES (
        10001, 'legacy-pending', 100, '', 'legacy offline', 1, 0, 0,
        'pending', 0, NULL, 100, 100
      );
    `)
    legacyDatabase.close()

    const upgraded = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    expect(await upgraded.listPending(10001)).toMatchObject([{
      recordUid: 'legacy-pending', textContent: 'legacy offline', attempts: 0,
    }])
    await upgraded.putPending(10001, {
      ...capturedPending('legacy-pending', 'legacy offline'),
      captureContext: { clientName: 'Google Chrome（DeepSeek Harness）', electric: 0, charge: 2 },
    })
    upgraded.close()

    const reopened = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    expect(await reopened.listPending(10001)).toMatchObject([{
      recordUid: 'legacy-pending', recordDurationMillis: 3_400,
      captureContext: { clientName: 'Google Chrome（DeepSeek Harness）', electric: 0, charge: 2 },
    }])
    reopened.close()
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
      canUpdateArkmeId: false,
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

  it('durably stores extension review recovery state per account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-arkme-review-db-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const operation: ArkmeExtensionReviewOperation = {
      extensionId: 'ext-review',
      recordUid: '11111111-1111-4111-8111-111111111111',
      textContent: '首页与扩展详情都要保留',
      rating: 5,
      clientMutationId: 'review-mutation-0001',
      state: 'record_pending',
      attempts: 0,
      createdAtMillis: 123,
    }

    await database.putExtensionReviewOperation(10001, operation)
    expect(await database.listExtensionReviewOperations(10001)).toEqual([operation])
    expect(await database.listExtensionReviewOperations(10002)).toEqual([])

    await database.markExtensionReviewOperation(10001, operation.clientMutationId, 'registry_pending')
    expect(await database.listExtensionReviewOperations(10001)).toMatchObject([{
      state: 'registry_pending', attempts: 1,
    }])
    await database.markExtensionReviewOperation(10001, operation.clientMutationId, 'failed', 'registry unavailable')
    expect(await database.listExtensionReviewOperations(10001)).toMatchObject([{
      state: 'failed', attempts: 2, lastError: 'registry unavailable',
    }])
    database.close()

    const reopened = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    expect(await reopened.listExtensionReviewOperations(10001)).toHaveLength(1)
    await reopened.removeExtensionReviewOperation(10001, operation.clientMutationId)
    expect(await reopened.listExtensionReviewOperations(10001)).toEqual([])
    reopened.close()
  })
})

describe('durable conversation directory', () => {
  it('restores incrementally written rows, pin/hidden state and image bytes after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme sidebar cache '))
    const operational = new ArkmeStateStore(directory)
    let db = new ArkmeLocalDatabase(directory, operational)
    const source = { sourceRef: 'ref', sourceKey: 'stable', kind: 'private_chat' as const, displayName: 'One', activeAtMillis: 1, unreadCount: 2, isPinned: true, avatarRef: 'image' }
    const projection = { revision: 1, phase: 'complete' as const, cachedAtMillis: 2, bots: [], visibility: [{ entryKind: 'source' as const, entryRef: 'ref', hidden: true }] }
    await db.writeDirectoryCache(1, { directory: 'root', items: [source], hasMore: false, projection })
    await db.writeDirectoryCache(1, { directory: 'root', items: [{ ...source, sourceKey: 'other', sourceRef: 'ref2' }], hasMore: false, projection: { ...projection, visibility: [], revision: 2 } })
    await db.writeAvatarCache(1, 'image', { mediaType: 'image/png', bytes: 3, data: new Uint8Array([1, 2, 3]) })
    db.close()
    db = new ArkmeLocalDatabase(directory, operational)
    const restored = await db.readDirectoryCache(1)
    expect(restored?.items).toHaveLength(2)
    expect(restored?.items[0]).toMatchObject({ isPinned: true, avatarRef: 'image' })
    expect(restored?.projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: 'ref', hidden: true })
    expect(await db.readDirectoryCache(2)).toBeUndefined()
    expect(await db.readAvatarCache(2, 'image')).toBeUndefined()
    expect(Array.from((await db.readAvatarCache(1, 'image'))!.data)).toEqual([1, 2, 3])
    db.close()
  })
})


it('retains Bot visibility across source-only disk deltas and a reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme sidebar bot visibility '))
  const operational = new ArkmeStateStore(directory)
  let db = new ArkmeLocalDatabase(directory, operational)
  const hidden = { entryKind: 'bot' as const, entryRef: 'bot-ref', hidden: true }
  const projection = { revision: 1, phase: 'complete' as const, cachedAtMillis: 2, bots: [], visibility: [hidden] }
  await db.writeDirectoryCache(1, { directory: 'root', items: [], hasMore: false, projection })
  await db.writeDirectoryCache(1, { directory: 'root', items: [], hasMore: false, projection: { ...projection, visibility: [], revision: 2 } })
  db.close(); db = new ArkmeLocalDatabase(directory, operational)
  expect((await db.readDirectoryCache(1))?.projection?.visibility).toContainEqual(hidden)
  db.close()
})


it('persists explicit source removal even when coalesced with an older row delta', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme group removal '))
  const db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  const source = { sourceRef: 'ref', sourceKey: 'key', kind: 'group_chat' as const, displayName: 'Left', activeAtMillis: 1, unreadCount: 0 }
  const projection = { revision: 1, phase: 'complete' as const, cachedAtMillis: 1, bots: [], visibility: [] }
  await db.writeDirectoryCache(1, { directory: 'root', items: [source], hasMore: false, projection })
  await db.writeDirectoryCache(1, { directory: 'root', items: [source], hasMore: false, projection: { ...projection, revision: 2, removedSourceKeys: ['key'] } })
  expect((await db.readDirectoryCache(1))?.items).toEqual([])
  db.close()
})


it('does not accumulate retired Bot handles in durable visibility metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme bot handle rotation '))
  const db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  const bot = { botRef: 'old', directoryKey: 'stable', name: 'Bot', provider: 'openclaw' as const, description: '', status: 'offline' as const, directChatAvailable: true }
  const projection = { revision: 1, phase: 'complete' as const, cachedAtMillis: 1, bots: [bot], visibility: [{ entryKind: 'bot' as const, entryRef: 'old', hidden: true }] }
  await db.writeDirectoryCache(1, { directory: 'root', items: [], hasMore: false, projection })
  await db.writeDirectoryCache(1, { directory: 'root', items: [], hasMore: false, projection: { ...projection, revision: 2, bots: [{ ...bot, botRef: 'new' }], visibility: [{ entryKind: 'bot', entryRef: 'new', hidden: true }] } })
  expect((await db.readDirectoryCache(1))?.projection?.visibility).toEqual([{ entryKind: 'bot', entryRef: 'new', hidden: true }])
  db.close()
})
