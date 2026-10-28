import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalSelfNoteQuotes } from '../../src/local-self-note-quotes.js'
import { selectedTextNoteWireText, type SelectedTextNoteQuote } from '../../src/selected-text-note.js'
import { sendSelectedTextSelfNote } from '../../src/services/selected-text-self-note.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import { RecordService } from '../../src/services/record-service.js'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()) })
const uid = 'c42f0a3c-c438-4b81-9dd9-21605f8f626d'
const quote: SelectedTextNoteQuote = { version: 1, sourceLabel: 'Codex · 产品讨论', senderName: 'Codex', sourceAtMillis: 1792752000000, text: '被引用的原文\n只包含这一部分' }
const input = { expectedAccountKey: 'prod:11', recordUid: uid, noteText: '自己的想法', quote }
function fixture(path = ':memory:') {
  const db = new DatabaseSync(path); let closed = false
  const close = () => { if (!closed) { closed = true; db.close() } }; cleanups.push(close)
  const store = new LocalSelfNoteQuotes(db), session = { userId: 11, refreshToken: 'account-session' }
  const runtime = { config: { environment: 'prod', maxTextLength: 20000 }, stateStore: { selfNoteQuotes: store }, requireSession: vi.fn(async () => session), accountScopedSession: vi.fn(async () => session) } as unknown as ServiceRuntime
  return { store, runtime, close }
}
it('persists the exact quotation before sending and restores it after process restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'self-quote-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'quotes.sqlite'), first = fixture(path)
  const send = vi.fn(async (text: string) => {
    expect(first.store.project('prod:11', uid, text)?.quote).toEqual(quote)
    return { sourceRef: 'self', itemUid: uid, status: 1, localState: 'synced' as const }
  })
  await sendSelectedTextSelfNote(first.runtime, input, send)
  first.close()
  const next = fixture(path), wire = selectedTextNoteWireText(input.noteText, quote)
  expect(next.store.project('prod:11', uid, wire)).toMatchObject({ quote, noteText: input.noteText, storage: 'local' })
  expect(next.store.project('prod:12', uid, wire)).toBeUndefined()
  expect(next.store.project('dev:11', uid, wire)).toBeUndefined()
  expect(send).toHaveBeenCalledOnce()
})
it('retains the quote after editing only the thought, but never guesses a changed quote', () => {
  const { store } = fixture(); store.prepare('prod:11', uid, quote, input.noteText)
  expect(store.project('prod:11', uid, selectedTextNoteWireText('修改后的思考', quote))?.noteText).toBe('修改后的思考')
  expect(store.project('prod:11', uid, selectedTextNoteWireText(input.noteText, { ...quote, text: '原文被改了' }))).toBeUndefined()
  expect(store.project('prod:11', 'unrelated', selectedTextNoteWireText(input.noteText, quote))).toBeUndefined()
})
it('freezes retry identity/content and refuses login swaps, invalid input and storage failure before any send', async () => {
  const { runtime, store } = fixture(), send = vi.fn(async () => { throw new Error('timeout') })
  await expect(sendSelectedTextSelfNote(runtime, input, send)).rejects.toThrow('timeout')
  await expect(sendSelectedTextSelfNote(runtime, { ...input, noteText: '不同内容' }, send)).rejects.toThrow('冻结')
  await expect(sendSelectedTextSelfNote(runtime, { ...input, expectedAccountKey: 'prod:12' }, send)).rejects.toMatchObject({ code: 'self-note-account-changed' })
  await expect(sendSelectedTextSelfNote(runtime, { ...input, quote: { ...quote, text: 'x'.repeat(2001) } }, send)).rejects.toMatchObject({ code: 'self-note-invalid' })
  vi.mocked(runtime.accountScopedSession).mockResolvedValueOnce(undefined)
  await expect(sendSelectedTextSelfNote(runtime, input, send)).rejects.toMatchObject({ code: 'self-note-account-changed' })
  vi.spyOn(store, 'prepare').mockImplementationOnce(() => { throw new Error('disk full') })
  await expect(sendSelectedTextSelfNote(runtime, input, send)).rejects.toThrow('disk full')
  expect(send).toHaveBeenCalledTimes(1)
})
it('does not acknowledge a mismatched or pending receipt', async () => {
  const { runtime } = fixture()
  for (const result of [{ sourceRef: 'self', itemUid: 'wrong', status: 1, localState: 'synced' as const }, { sourceRef: 'self', itemUid: uid, status: 0, localState: 'failed' as const }]) {
    await expect(sendSelectedTextSelfNote(runtime, input, async () => result)).rejects.toMatchObject({ code: 'self-note-unconfirmed' })
  }
})
it('projects only owned, available records without changing the authoritative text used by edit/reply actions', () => {
  const { runtime, store } = fixture(); store.prepare('prod:11', uid, quote, input.noteText)
  const record = new RecordService(runtime, { richContentBlocks: () => [], recordMediaUnavailable: () => false } as never, {} as never)
  const raw = { record_uid: uid, owner_user_id: 11, status: 1, text_content: selectedTextNoteWireText(input.noteText, quote) }
  const result = record.recordTimelineItemFromRaw(raw, 11)
  expect(result.textContent).toBe(raw.text_content); expect(result.localSelfQuote?.quote).toEqual(quote)
  expect(record.recordTimelineItemFromRaw({ ...raw, owner_user_id: 12 }, 11).localSelfQuote).toBeUndefined()
  expect(record.recordTimelineItemFromRaw({ ...raw, status: 2 }, 11).localSelfQuote).toBeUndefined()
})
