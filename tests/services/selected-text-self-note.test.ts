import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordExcerptPresentation, type RecordExcerpt } from '../../src/record-excerpt.js'
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
it('sends the exact frozen excerpt through Record and renders it on a second device without local quote rows', async () => {
  const first=fixture(),next=fixture()
  let frozen:RecordExcerpt|undefined,wire=''
  const send=vi.fn(async(text:string,_user:number,excerpt:RecordExcerpt)=>{
    frozen=structuredClone(excerpt);wire=text
    expect(first.store.project('prod:11',uid,text)).toBeUndefined()
    return {sourceRef:'self',itemUid:uid,status:1,localState:'synced' as const}
  })
  await sendSelectedTextSelfNote(first.runtime,input,send)
  const presentation=recordExcerptPresentation(frozen,wire)
  expect(presentation).toMatchObject({quote:{text:quote.text},noteText:input.noteText,storage:'cloud'})
  expect(next.store.project('prod:11',uid,wire)).toBeUndefined()
  expect(send).toHaveBeenCalledOnce()
})
it('retains the quote after editing only the thought, but never guesses a changed quote', () => {
  const { store } = fixture(); store.prepare('prod:11', uid, quote, input.noteText)
  expect(store.project('prod:11', uid, selectedTextNoteWireText('修改后的思考', quote))?.noteText).toBe('修改后的思考')
  expect(store.project('prod:11', uid, selectedTextNoteWireText(input.noteText, { ...quote, text: '原文被改了' }))).toBeUndefined()
  expect(store.project('prod:11', 'unrelated', selectedTextNoteWireText(input.noteText, quote))).toBeUndefined()
})
it('checks account and quote boundaries before delegating to the Record outbox', async () => {
  const {runtime}=fixture(),send=vi.fn(async()=>{throw Error('timeout')})
  await expect(sendSelectedTextSelfNote(runtime,input,send)).rejects.toThrow('timeout')
  await expect(sendSelectedTextSelfNote(runtime,{...input,expectedAccountKey:'prod:12'},send)).rejects.toMatchObject({code:'self-note-account-changed'})
  await expect(sendSelectedTextSelfNote(runtime,{...input,quote:{...quote,text:'x'.repeat(2001)}},send)).rejects.toMatchObject({code:'self-note-invalid'})
  vi.mocked(runtime.accountScopedSession).mockResolvedValueOnce(undefined)
  await expect(sendSelectedTextSelfNote(runtime,input,send)).rejects.toMatchObject({code:'self-note-account-changed'})
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

it('saves a quote-only forward to self without inventing a note, while the note action still requires one',async()=>{
 const {runtime}=fixture();let saved:RecordExcerpt|undefined,text=''
 const send=vi.fn(async(value:string,_user:number,excerpt:RecordExcerpt)=>{text=value;saved=excerpt;return {sourceRef:'self',itemUid:uid,status:1,localState:'synced' as const}})
 await expect(sendSelectedTextSelfNote(runtime,{...input,noteText:''},send)).rejects.toMatchObject({code:'self-note-invalid'})
 await sendSelectedTextSelfNote(runtime,{...input,noteText:''},send,undefined,true)
 expect(recordExcerptPresentation(saved,text)).toMatchObject({quote:{text:quote.text},noteText:''})
})
