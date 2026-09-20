import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { memberFacts } from './helpers/member-page-fixture.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberUpdate } from '../src/types.js'

const member = (memberRef: string, displayName = memberRef): ArkmeConversationMemberItem => ({
  memberRef, displayName, role: 'member', status: 'active', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 9, mentionCount: 1,
})
const source = { sourceRef: 'ref', sourceKey: 'group', kind: 'group_chat' as const, displayName: '群' }
const page = (items: ArkmeConversationMemberItem[], complete = true): ArkmeConversationMemberUpdate => complete
  ? { kind: 'presentation', source, items, removedMemberRefs: [], unavailableProfileMemberRefs: [] }
  : { kind: 'membership', selfRole: 'member', source, items: items.map(memberFacts), removedMemberRefs: [], hasMore: false }

async function seed(db: ArkmeLocalDatabase, user: number, group: string, items: ArkmeConversationMemberItem[]) {
  await db.mergeConversationMembers(user, group, page(items, false))
  await db.mergeConversationMembers(user, group, page(items))
}

describe('persistent member cache', () => {
  it('migrates the old table once without rewriting old cache contents or unrelated records', async () => {
    const path = await mkdtemp(join(tmpdir(), 'arkme old member cache '))
    const file = join(path, 'records.sqlite3')
    const old = new DatabaseSync(file)
    const payload = JSON.stringify({ items: [member('a')], joinEvents: [] })
    old.exec('CREATE TABLE conversation_member_cache (user_id INTEGER NOT NULL, group_key TEXT NOT NULL, snapshot_json TEXT NOT NULL, updated_at_millis INTEGER NOT NULL, PRIMARY KEY(user_id, group_key)); CREATE TABLE unrelated_data (value TEXT)')
    old.prepare('INSERT INTO conversation_member_cache VALUES (?, ?, ?, ?)').run(42, 'group', payload, Date.now())
    old.prepare('INSERT INTO unrelated_data VALUES (?)').run('keep')
    old.close()
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
        try { expect(await db.cachedConversationMembers(42, 'group')).toBeUndefined() } finally { db.close() }
        const raw = new DatabaseSync(file)
        try {
          expect(raw.prepare('SELECT snapshot_json, payload_bytes FROM conversation_member_cache').get()).toMatchObject({ snapshot_json: payload, payload_bytes: Buffer.byteLength(payload) })
          expect(raw.prepare('SELECT value FROM unrelated_data').get()?.value).toBe('keep')
        } finally { raw.close() }
      }
    } finally { await rm(path, { recursive: true }) }
  })

  it('does not let a late presentation result create or resurrect membership', async () => {
    const path = await mkdtemp(join(tmpdir(), 'arkme member cache '))
    const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
    try {
      await db.mergeConversationMembers(42, 'group', page([member('a')]))
      expect(await db.cachedConversationMembers(42, 'group')).toBeUndefined()
      await seed(db, 42, 'group', [member('a'), member('b')])
      await db.mergeConversationMembers(42, 'group', { ...page([], false), removedMemberRefs: ['a'] })
      await db.mergeConversationMembers(42, 'group', page([member('a', '晚到的资料')]))
      expect((await db.cachedConversationMembers(42, 'group'))?.items.map(item => item.memberRef)).toEqual(['b'])
      await db.mergeConversationMembers(42, 'group', page([member('c')], false))
      await db.forgetCachedMembers(42, 'group', ['a'])
      expect((await db.cachedConversationMembers(42, 'group'))?.items.map(item => item.memberRef)).toEqual(['b', 'c'])
    } finally { db.close(); await rm(path, { recursive: true }) }
  })
  it('survives a database restart in a path with spaces and isolates account/group scopes', async () => {
    const path = await mkdtemp(join(tmpdir(), 'arkme member cache '))
    let db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
    try {
      await seed(db, 42, 'group-a', [member('a', '缓存名字')])
      await seed(db, 42, 'group-b', [member('b')])
      await seed(db, 43, 'group-a', [member('c')])
      db.close(); db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
      expect((await db.cachedConversationMembers(42, 'group-a'))?.items.map(item => item.displayName)).toEqual(['缓存名字'])
      expect((await db.cachedConversationMembers(42, 'group-b'))?.items.map(item => item.memberRef)).toEqual(['b'])
      expect((await db.cachedConversationMembers(43, 'group-a'))?.items.map(item => item.memberRef)).toEqual(['c'])
      expect(await db.cachedConversationMembers(44, 'group-a')).toBeUndefined()
      await db.clearConversationMembers(42, 'group-a')
      expect(await db.cachedConversationMembers(42, 'group-a')).toBeUndefined()
      expect(await db.cachedConversationMembers(43, 'group-a')).toBeDefined()
    } finally { db.close(); await rm(path, { recursive: true }) }
  })

  it('merges pages without erasing cached presentation and applies only explicit removals', async () => {
    const path = await mkdtemp(join(tmpdir(), 'arkme member cache '))
    const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
    try {
      await seed(db, 42, 'group', [{ ...member('a', '备注'), avatarRef: 'avatar' }, member('b')])
      await Promise.all([
        db.mergeConversationMembers(42, 'group', page([{ ...member('a', '群成员'), recordCount: 0 }], false)),
        db.mergeConversationMembers(42, 'group', page([member('c')], false)),
      ])
      let cache = await db.cachedConversationMembers(42, 'group')
      expect(cache?.items).toHaveLength(3)
      expect(cache?.items.find(item => item.memberRef === 'a')).toMatchObject({ displayName: '备注', recordCount: 9, avatarRef: 'avatar' })
      await db.mergeConversationMembers(42, 'group', { ...page([member('a', '新昵称')]), removedMemberRefs: ['b'] })
      cache = await db.cachedConversationMembers(42, 'group')
      expect(cache?.items.map(item => item.memberRef)).toEqual(['a', 'c'])
      expect(cache?.items[0]?.avatarRef).toBeUndefined()
    } finally { db.close(); await rm(path, { recursive: true }) }
  })

  it('treats corrupt cache as a miss and bounds retained groups', async () => {
    const path = await mkdtemp(join(tmpdir(), 'arkme member cache '))
    const db = new ArkmeLocalDatabase(path, new ArkmeStateStore(path))
    try {
      for (let index = 0; index < 101; index++) await seed(db, 42, String(index), [member(String(index))])
      const raw = new DatabaseSync(join(path, 'records.sqlite3'))
      try {
        expect(raw.prepare('SELECT COUNT(*) AS n FROM conversation_member_cache').get()?.n).toBe(100)
        const snapshot = JSON.parse(String(raw.prepare('SELECT snapshot_json FROM conversation_member_cache WHERE group_key = ?').get('100')?.snapshot_json))
        snapshot.joinEvents = [{ eventId: 'bad', action: 'invite', occurredAtMillis: 1, inviter: {}, invitees: [] }]
        raw.prepare('UPDATE conversation_member_cache SET snapshot_json = ? WHERE group_key = ?').run(JSON.stringify(snapshot), '100')
        expect(await db.cachedConversationMembers(42, '100')).toBeUndefined()
        raw.prepare('UPDATE conversation_member_cache SET snapshot_json = ? WHERE group_key = ?').run('{bad json', '100')
        expect(await db.cachedConversationMembers(42, '100')).toBeUndefined()
      } finally { raw.close() }
    } finally { db.close(); await rm(path, { recursive: true }) }
  })
})
