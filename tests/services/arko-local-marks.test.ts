import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalMessageMarkStore } from '../../src/local-message-marks.js'
import { quoteCanonicalText, quoteSourceContent, type ArkmeMessageQuote } from '../../src/message-quote.js'
import { ArkoLocalMarks } from '../../src/services/arko-local-marks.js'
import { ArkoService } from '../../src/services/arko-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import type { ArkmeArkoHistoryItem } from '../../src/types.js'

const databases: DatabaseSync[] = []
afterEach(() => { databases.splice(0).forEach(db => db.close()) })
const message = (fields: Partial<ArkmeArkoHistoryItem> = {}): ArkmeArkoHistoryItem => ({
  messageId: 3, sessionId: 88, role: 'assistant', text: '**重点**和[链接](https://example.com)',
  reasoning: '不可标记的思考', createdAtMillis: 1000, status: 1, createdRecordUids: [], ...fields,
})
function anchor(item: ArkmeArkoHistoryItem, text = '重点'): ArkmeMessageQuote {
  const source = { title: '', textContent: item.text, textFormat: item.role === 'assistant' ? 'markdown' as const : 'plain' as const }
  const canonical = quoteCanonicalText(source), start = canonical.indexOf(text), end = start + text.length
  return { version: 1, projection: 'arkme-text-v1', sourceDigest: createHash('sha256').update(quoteSourceContent(source)).digest('hex'),
    start, end, text, prefix: canonical.slice(Math.max(0, start - 32), start), suffix: canonical.slice(end, end + 32) }
}
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db)
  const store = new LocalMessageMarkStore(db, work => {
    db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
  })
  let session = { userId: 11, accessToken: 'test', refreshToken: 'refresh' }
  const runtime = new ServiceRuntime({ environment: 'test' } as ArkmeServiceConfig, {} as ArkmeSessionStore,
    { messageMarks: store, uniqueCode: async () => 'machine-key' } as StateStore)
  vi.spyOn(runtime, 'requireSession').mockImplementation(async () => session)
  vi.spyOn(runtime, 'accountScopedSession').mockImplementation(async () => session)
  return { db, runtime, service: new ArkoLocalMarks(runtime), switchAccount() { session = { ...session, userId: 12 } } }
}
const source = 'arko:test:11'
it('persists both roles through service recreation and reference rotation, and cancels without resurrection', async () => {
  const { runtime, service } = fixture()
  for (const role of ['user', 'assistant'] as const) {
    const item = message({ role, messageId: role === 'user' ? 1 : 2 }), ref = await service.project(item, 11)
    expect(ref).not.toContain('重点')
    const change = { kind: 'add' as const, operationId: `add-${role}`, anchor: anchor(item) }
    const saved = await service.change(source, ref!, change)
    expect(saved.items).toHaveLength(1)
    const restarted = new ArkoLocalMarks(runtime), rotated = await restarted.project(item, 11)
    expect(rotated).not.toBe(ref)
    expect((await restarted.list(source, [rotated!]))[0]?.snapshot.items).toEqual(saved.items)
    await restarted.change(source, rotated!, { kind: 'remove', operationId: `remove-${role}`, annotationId: saved.items[0]!.id })
    expect((await restarted.change(source, ref!, change)).items).toEqual([])
  }
})
it('keeps different historical sessions separate even with equal message ids', async () => {
  const { service } = fixture(), item = message(), ref = await service.project(item, 11)
  await service.change(source, ref!, { kind: 'add', operationId: 'add-one', anchor: anchor(item) })
  const other = await service.project(message({ sessionId: 99 }), 11)
  const rows = await service.list(source, [ref!, other!])
  expect(rows.map(row => row.snapshot.items.length)).toEqual([1, 0])
})
it('never grants marking for streaming, failed, missing or empty content', async () => {
  const { service } = fixture()
  for (const fields of [{ status: 2 }, { text: '' }, { runStatus: 'running' }, { runStatus: 'queued' },
    { runStatus: 'waiting_user' }, { runStatus: 'waiting_tool' }, { runStatus: 'failed' }]) {
    expect(await service.project(message(fields), 11)).toBeUndefined()
  }
  expect(await service.project(message({ runStatus: 'completed' }), 11)).toBeTruthy()
})
it('rejects another account, environment, tampered reference, and a logout during a write', async () => {
  const f = fixture(), item = message(), ref = await f.service.project(item, 11)
  await expect(f.service.list('arko:prod:11', [ref!])).rejects.toMatchObject({ httpStatus: 403 })
  await expect(f.service.list(source, [`${ref}x`])).rejects.toMatchObject({ httpStatus: 403 })
  f.switchAccount()
  await expect(f.service.list('arko:test:12', [ref!])).rejects.toMatchObject({ httpStatus: 403 })
  const other = fixture(), ownedRef = await other.service.project(item, 11)
  vi.mocked(other.runtime.accountScopedSession).mockResolvedValue(undefined)
  await expect(other.service.change(source, ownedRef!, { kind: 'add', operationId: 'race', anchor: anchor(item) })).rejects.toMatchObject({ code: 'arko-local-mark-account-changed' })
})
it('validates the actual Markdown selection and flags edited content instead of relocating guesses', async () => {
  const { service } = fixture(), item = message(), ref = await service.project(item, 11), quote = anchor(item)
  await expect(service.change(source, ref!, { kind: 'add', operationId: 'wrong', anchor: { ...quote, text: '错字' } })).rejects.toMatchObject({ code: 'arko-local-mark-source-changed' })
  await service.change(source, ref!, { kind: 'add', operationId: 'right', anchor: quote })
  const edited = await service.project(message({ text: '新的回答' }), 11)
  expect((await service.list(source, [edited!]))[0]?.snapshot.items[0]?.state).toBe('stale')
})
it('supports a long answer beyond small reference limits and surfaces a failed local save', async () => {
  const { runtime, service } = fixture(), item = message({ text: '很长的回答。'.repeat(5000) + '重点' })
  const ref = await service.project(item, 11)
  expect(ref!.length).toBeGreaterThan(16_384)
  expect((await service.change(source, ref!, { kind: 'add', operationId: 'long', anchor: anchor(item) })).items).toHaveLength(1)
  vi.spyOn(runtime.stateStore.messageMarks!, 'change').mockImplementation(() => { throw new Error('disk full') })
  await expect(service.change(source, ref!, { kind: 'add', operationId: 'disk', anchor: anchor(item) })).rejects.toMatchObject({ code: 'arko-local-mark-save-failed' })
})
it('projects local mark authority through the real history service without cloud mark requests', async () => {
  const { runtime } = fixture()
  const upstream = vi.fn(async () => ({ message_ls: [{ id: 3, session_id: 88, role: 3, content: '**重点**', status: 1 }] }))
  runtime.authenticatedIntelligentPost = upstream as never
  const service = new ArkoService(runtime, new ProfileService(runtime))
  const result = await service.arkoHistoryPage()
  expect(result.items[0]?.localMarkRef).toMatch(/^arkme-arko-local-mark-v1\./)
  await service.localMarks.capabilities(source)
  await service.localMarks.list(source, [result.items[0]!.localMarkRef!])
  expect(upstream).toHaveBeenCalledTimes(1)
})
