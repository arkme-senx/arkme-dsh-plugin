import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'

async function fixture(byteWeight = 1024 * 1024) {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-avatar-eviction-'))
  const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  const sql = (database as unknown as { database: DatabaseSync }).database
  // Exercise the real 256 MiB accounting/transaction with small fixture blobs.
  sql.function('length', value => value instanceof Uint8Array ? value.byteLength * byteWeight : String(value).length)
  const insert = sql.prepare('INSERT INTO avatar_cache VALUES (?, ?, ?, ?, ?)')
  return {
    database, sql,
    avatar: (user: number, ref: string, bytes: number, touched: number) => insert.run(user, ref, 'image/png', new Uint8Array(bytes), touched),
    close: async () => { database.close(); await rm(directory, { recursive: true, force: true }) },
  }
}

it('keeps all nested directory/metadata references account-scoped and evicts the oldest unreferenced image', async () => {
  const f = await fixture()
  try {
    f.sql.prepare('INSERT INTO conversation_directory VALUES (?, ?, ?, NULL)').run(1, 'directory', JSON.stringify({ nested: ['pinned', '42', '1', [7, 8]] }))
    f.sql.prepare('INSERT INTO conversation_directory_meta VALUES (?, ?)').run(1, JSON.stringify({ bot: { avatar: 'bot-image' } }))
    for (const ref of ['pinned', '42', '1', '[7,8]', 'bot-image']) f.avatar(1, ref, 40, 0)
    f.avatar(2, 'pinned', 32, 1) // Another account's directory cannot pin this row.
    f.avatar(1, 'recent', 24, 2)
    await f.database.writeAvatarCache(1, 'new', { mediaType: 'image/png', data: new Uint8Array(2), bytes: 2 })
    expect(f.sql.prepare('SELECT user_id, image_ref FROM avatar_cache ORDER BY image_ref').all()).toEqual(
      ['1', '42', '[7,8]', 'bot-image', 'new', 'pinned', 'recent'].map(image_ref => ({ user_id: 1, image_ref })),
    )
    expect(f.sql.prepare('SELECT sum(length(data)) AS bytes FROM avatar_cache').get()).toEqual({ bytes: 226 * 1024 * 1024 })
  } finally { await f.close() }
})

it('rolls back an over-budget replacement when every image is still referenced', async () => {
  const f = await fixture()
  try {
    f.sql.prepare('INSERT INTO conversation_directory_meta VALUES (?, ?)').run(1, JSON.stringify({ avatars: ['a', 'b', 'c', 'd'] }))
    for (const ref of ['a', 'b', 'c', 'd']) f.avatar(1, ref, 64, 1)
    await expect(f.database.writeAvatarCache(1, 'a', { mediaType: 'image/jpeg', data: new Uint8Array(65), bytes: 65 }))
      .rejects.toThrow('previous directory images retained')
    expect(f.sql.prepare('SELECT media_type, length(data) AS bytes, touched_at FROM avatar_cache WHERE image_ref=?').get('a'))
      .toEqual({ media_type: 'image/png', bytes: 64 * 1024 * 1024, touched_at: 1 })
    expect(f.sql.prepare('SELECT sum(length(data)) AS bytes FROM avatar_cache').get()).toEqual({ bytes: 256 * 1024 * 1024 })
  } finally { await f.close() }
})

it('does not block the Host for seconds when a full avatar cache meets a large directory', async () => {
  const f = await fixture(160_000)
  try {
    f.sql.exec('BEGIN')
    const insertDirectory = f.sql.prepare('INSERT INTO conversation_directory VALUES (?, ?, ?, NULL)')
    for (let i = 0; i < 501; i++) insertDirectory.run(1, `source-${i}`, JSON.stringify({
      nested: Array.from({ length: 50 }, (_, j) => `directory-${i}-${j}`),
    }))
    for (let i = 0; i < 1705; i++) f.avatar(1, `avatar-${i}`, 1, i)
    f.sql.exec('COMMIT')
    const start = performance.now()
    await f.database.writeAvatarCache(1, 'new', { mediaType: 'image/png', data: new Uint8Array(1), bytes: 1 })
    expect(performance.now() - start).toBeLessThan(1000)
    expect(f.sql.prepare('SELECT count(*) AS count, sum(length(data)) AS bytes FROM avatar_cache').get())
      .toEqual({ count: 1677, bytes: 268_320_000 })
    expect(f.sql.prepare('SELECT image_ref FROM avatar_cache WHERE image_ref=?').get('avatar-28')).toBeUndefined()
    expect(f.sql.prepare('SELECT image_ref FROM avatar_cache WHERE image_ref=?').get('avatar-29')).toEqual({ image_ref: 'avatar-29' })
  } finally { await f.close() }
}, 15_000)
