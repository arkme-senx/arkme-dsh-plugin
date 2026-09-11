import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { arkmeDefaultEmojiSeeds } from '../src/arkme-emoji-text.js'
import { DatabaseSync } from 'node:sqlite'

const permissionFault = vi.hoisted(() => ({ fail: false }))
vi.mock('../src/private-filesystem.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/private-filesystem.js')>()
  return { ...original, securePrivateFileSync: (path: string) => {
    if (permissionFault.fail) throw new Error('simulated permission failure')
    return original.securePrivateFileSync(path)
  } }
})

const directories: string[] = []
const databases = new Set<ArkmeLocalDatabase>()
afterEach(async () => { permissionFault.fail = false; for (const db of databases) db.close(); databases.clear(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-emoji-recent-'))
  directories.push(directory)
  const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  databases.add(database)
  return { directory, database }
}

describe('recent emoji durable local owner', () => {
  it('sanitizes persisted values without treating tokens or sticker assets as emoji IDs', async () => {
    const { directory, database } = await fixture()
    const raw = new DatabaseSync(join(directory, 'records.sqlite3'))
    try {
      const write = raw.prepare('INSERT OR REPLACE INTO recent_emoji (account_key, emoji_ids) VALUES (?, ?)')
      for (const value of [null, {}, 'angry_face', 42]) {
        write.run('prod:42', JSON.stringify(value))
        expect(await database.recentEmojiIds('prod:42')).toEqual([])
      }
      write.run('prod:42', JSON.stringify(['angry_face', '[jm_emoji:joy_face]', '😡', null, '__proto__', 'asset-sticker', 'angry_face', 'joy_face']))
      expect(await database.recentEmojiIds('prod:42')).toEqual(['angry_face', 'joy_face'])
      await database.recordRecentEmoji('prod:42', 'joy_face')
      expect(JSON.parse(String(raw.prepare('SELECT emoji_ids FROM recent_emoji WHERE account_key=?').get('prod:42')!.emoji_ids)))
        .toEqual(['joy_face', 'angry_face'])
    } finally { raw.close() }
  })
  it('does not commit a mutation that fails private-file enforcement', async () => {
    const { database } = await fixture()
    await database.recordRecentEmoji('prod:42', 'angry_face')
    permissionFault.fail = true
    await expect(database.recordRecentEmoji('prod:42', 'joy_face')).rejects.toThrow()
    permissionFault.fail = false
    expect(await database.recentEmojiIds('prod:42')).toEqual(['angry_face'])
  })
  it('does not write a timed-out request after slow session resolution completes', async () => {
    const { database } = await fixture()
    let resume!: (session: { userId: number }) => void
    const service = Object.assign(Object.create(ArkmeService.prototype), {
      config: { environment: 'prod' }, stateStore: database,
      runtime: { requireSession: () => new Promise(resolve => { resume = resolve }) },
    }) as ArkmeService
    const controller = new AbortController()
    const write = dispatchArkmeHostOperation(service, 'emoji.recent.record', { accountKey: 'prod:42', emojiId: 'angry_face' },
      undefined, undefined, undefined, undefined, controller.signal)
    controller.abort(new Error('client disconnected'))
    resume({ userId: 42 })
    await expect(write).rejects.toThrow('client disconnected')
    expect(await database.recentEmojiIds('prod:42')).toEqual([])
  })
  it('bounds history and recovers corrupt local data without accepting unknown IDs', async () => {
    const { directory, database } = await fixture()
    const ids = arkmeDefaultEmojiSeeds.slice(0, 12).map(emoji => emoji.id)
    for (const id of ids) await database.recordRecentEmoji('prod:42', id)
    expect(await database.recentEmojiIds('prod:42')).toEqual(ids.slice(-8).reverse())
    const raw = new DatabaseSync(join(directory, 'records.sqlite3'))
    raw.prepare('UPDATE recent_emoji SET emoji_ids=? WHERE account_key=?').run('{broken', 'prod:42')
    raw.close()
    expect(await database.recentEmojiIds('prod:42')).toEqual([])
    await expect(database.recordRecentEmoji('prod:42', 'unknown')).rejects.toThrow('Invalid recent emoji')
    await database.recordRecentEmoji('prod:42', 'angry_face')
    expect(await database.recentEmojiIds('prod:42')).toEqual(['angry_face'])
  })
  it('restores across runtime instances and isolates accounts and environments', async () => {
    const { directory, database } = await fixture()
    await database.recordRecentEmoji('prod:42', 'angry_face')
    await database.recordRecentEmoji('prod:42', 'joy_face')
    await database.recordRecentEmoji('prod:42', 'angry_face')
    database.close(); databases.delete(database)
    const restarted = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    databases.add(restarted)
    expect(await restarted.recentEmojiIds('prod:42')).toEqual(['angry_face', 'joy_face'])
    expect(await restarted.recentEmojiIds('prod:43')).toEqual([])
    expect(await restarted.recentEmojiIds('test:42')).toEqual([])
  })

  it('merges selections from separate inputs instead of overwriting with stale lists', async () => {
    const { directory, database } = await fixture()
    const second = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    databases.add(second)
    await Promise.all([
      database.recordRecentEmoji('prod:42', 'angry_face'),
      second.recordRecentEmoji('prod:42', 'joy_face'),
    ])
    expect(await database.recentEmojiIds('prod:42')).toEqual(['joy_face', 'angry_face'])
  })

  it('rolls back a failed write and uses the account index', async () => {
    const { directory, database } = await fixture()
    await database.recordRecentEmoji('prod:42', 'angry_face')
    const raw = new DatabaseSync(join(directory, 'records.sqlite3'))
    try {
      const plan = raw.prepare('EXPLAIN QUERY PLAN SELECT emoji_ids FROM recent_emoji WHERE account_key=?').all('prod:42')
      expect(plan.map(row => row.detail).join(' ')).toMatch(/SEARCH recent_emoji USING INDEX/)
      raw.exec("CREATE TRIGGER fail_recent_write BEFORE UPDATE ON recent_emoji BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END")
      await expect(database.recordRecentEmoji('prod:42', 'joy_face')).rejects.toThrow('simulated disk failure')
      expect(await database.recentEmojiIds('prod:42')).toEqual(['angry_face'])
      raw.exec('DROP TRIGGER fail_recent_write')
      await expect(database.recordRecentEmoji('prod:42', 'joy_face')).resolves.toEqual(['joy_face', 'angry_face'])
    } finally { raw.close() }
  })

  it('uses the real session owner without remote I/O and rejects logged-out access', async () => {
    const { database } = await fixture()
    let session: import('../src/keychain-store.js').ArkmeSessionCredentials | undefined = { userId: 42, accessToken: 'local-test', refreshToken: 'local-test' }
    const config: import('../src/arkme-service.js').ArkmeServiceConfig = {
      environment: 'test', authBaseUrl: 'https://auth.invalid', subjectBaseUrl: 'https://subject.invalid', recordBaseUrl: 'https://record.invalid',
      chatBaseUrl: 'https://chat.invalid', botBaseUrl: 'https://bot.invalid', imBaseUrl: 'https://im.invalid', webrtcBaseUrl: 'https://webrtc.invalid',
      worldBaseUrl: 'https://world.invalid', relationBaseUrl: 'https://relation.invalid', intelligentBaseUrl: 'https://intelligent.invalid',
      audioBaseUrl: 'https://audio.invalid', routePath: '/arkme-self/api', requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: '',
    }
    const fetch = vi.fn(async () => { throw new Error('recent emoji must remain local') })
    const service = new ArkmeService(config, { read: async () => session, write: async value => { session = value }, delete: async () => { session = undefined } }, database, fetch)
    try {
      await expect(service.recordRecentEmoji('test:42', 'angry_face')).resolves.toEqual(['angry_face'])
      await expect(service.recentEmojiIds('prod:42')).rejects.toMatchObject({ code: 'emoji-recent-account-changed' })
      for (const invalid of ['[jm_emoji:angry_face]', '😡', '__proto__', 'asset-sticker']) {
        await expect(service.recordRecentEmoji('test:42', invalid)).rejects.toMatchObject({ code: 'emoji-recent-invalid' })
      }
      session = undefined
      await expect(service.recentEmojiIds('test:42')).rejects.toMatchObject({ code: 'login-required' })
      expect(fetch).not.toHaveBeenCalled()
    } finally { service.dispose() }
  })

  it('rejects an account switch before persisting a delayed UI selection', async () => {
    const { database } = await fixture()
    const service = Object.assign(Object.create(ArkmeService.prototype), {
      config: { environment: 'prod' }, stateStore: database,
      runtime: { requireSession: async () => ({ userId: 43 }) },
    }) as ArkmeService
    await expect(dispatchArkmeHostOperation(service, 'emoji.recent.record', {
      accountKey: 'prod:42', emojiId: 'angry_face',
    })).rejects.toMatchObject({ code: 'emoji-recent-account-changed' })
    expect(await database.recentEmojiIds('prod:43')).toEqual([])
    await dispatchArkmeHostOperation(service, 'emoji.recent.record', { accountKey: 'prod:43', emojiId: 'joy_face' })
    await expect(dispatchArkmeHostOperation(service, 'emoji.recent.list', { accountKey: 'prod:43' }))
      .resolves.toEqual(['joy_face'])
    await expect(dispatchArkmeHostOperation(service, 'emoji.recent.record', { accountKey: 'prod:43', emojiId: 'unknown' }))
      .rejects.toMatchObject({ code: 'emoji-recent-invalid' })
  })
})
