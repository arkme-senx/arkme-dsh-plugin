import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { normalizeConversationViewports } from '../src/conversation-viewport-state.js'

it('persists bounded geometry across database restart and isolates accounts, environments and windows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arkme viewport '))
  let db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
  const anchor = { scrollTop: 1800, stickToBottom: false, anchorId: 'message:opaque', anchorOffset: -12 }
  try {
    await db.writeConversationViewports('test:1', 'main', [['chat:A', anchor]])
    db.close(); db = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    expect(await db.readConversationViewports('test:1', 'main')).toEqual([['chat:A', anchor]])
    expect(await db.readConversationViewports('test:2', 'main')).toEqual([])
    expect(await db.readConversationViewports('prod:1', 'main')).toEqual([])
    expect(await db.readConversationViewports('test:1', 'conversation:A')).toEqual([])
    for (let i = 0; i < 100; i++) await db.writeConversationViewports('test:1', `conversation:${i}`, [['A', anchor]])
    expect(await db.readConversationViewports('test:1', 'main')).toEqual([])
    expect(await db.readConversationViewports('test:1', 'conversation:99')).toHaveLength(1)
    const raw = new DatabaseSync(join(directory, 'records.sqlite3'))
    try { expect(raw.prepare('SELECT count(*) AS count FROM conversation_viewports').get()?.count).toBe(40) } finally { raw.close() }
    const service = Object.assign(Object.create(ArkmeService.prototype), { config: { environment: 'test' },
      stateStore: db, runtime: { requireSession: async () => ({ userId: 1 }) } }) as ArkmeService
    await expect(dispatchArkmeHostOperation(service, 'conversation.viewport.write', {
      accountKey: 'test:2', surface: 'main', entries: [['A', anchor]],
    })).rejects.toMatchObject({ code: 'viewport-account-changed' })
    await dispatchArkmeHostOperation(service, 'conversation.viewport.write', { accountKey: 'test:1', surface: 'main', entries: [['A', anchor]] })
    expect(await dispatchArkmeHostOperation(service, 'conversation.viewport.read', { accountKey: 'test:1', surface: 'main' })).toEqual([['A', anchor]])
    for (let account = 2; account <= 4; account++) for (let i = 0; i < 40; i++) {
      await db.writeConversationViewports(`test:${account}`, `conversation:${i}`, [['A', anchor]])
    }
    const bounded = new DatabaseSync(join(directory, 'records.sqlite3'))
    try { expect(bounded.prepare('SELECT count(*) AS count FROM conversation_viewports').get()?.count).toBe(80) } finally { bounded.close() }
  } finally { db.close(); await rm(directory, { recursive: true, force: true }) }
})
it('drops non-geometry fields and bounds UTF-8 payloads before persistence', () => {
  const entries = normalizeConversationViewports(Array.from({ length: 100 }, (_, i) => [String(i) + '源'.repeat(2000), {
    scrollTop: i, stickToBottom: false, anchorId: '锚'.repeat(1000), token: 'must not persist', text: 'message body',
  }]))
  expect(new TextEncoder().encode(JSON.stringify(entries)).byteLength).toBeLessThanOrEqual(65536)
  expect(JSON.stringify(entries)).not.toContain('must not persist')
  expect(entries.at(-1)?.[1].scrollTop).toBe(99)
  expect(normalizeConversationViewports([['A', { scrollTop: -1, stickToBottom: false }]])).toEqual([])
})
