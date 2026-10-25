import { DatabaseSync } from 'node:sqlite'
import { afterEach, it, expect, vi } from 'vitest'
import { LocalSelfNoteQuotes } from '../../src/local-self-note-quotes.js'
import { sendSelectedTextForward } from '../../src/services/selected-text-forward.js'
import { selectedTextForwardWireText, selectedTextNotePresentation } from '../../src/selected-text-note.js'
import type { ServiceRuntime } from '../../src/services/service.js'
const quote = { version: 1 as const, sourceLabel: '录音转写', senderName: '小明', sourceAtMillis: 1000, text: '选中原文' }
const input = { expectedAccountKey: 'prod:11', recordUid: '019d8592-ebb4-7232-90f2-000000000001', relationUid: '019d8592-ebb4-7232-90f2-000000000002', commentText: '', quote }
const dbs: DatabaseSync[] = []
afterEach(() => { dbs.splice(0).forEach(db => db.close()) })
function fixture() {
  const db = new DatabaseSync(':memory:'); dbs.push(db)
  const store = new LocalSelfNoteQuotes(db), session = { userId: 11, refreshToken: 'session' }
  const runtime = { config: { environment: 'prod', maxTextLength: 20000 }, stateStore: { selfNoteQuotes: store }, requireSession: vi.fn(async () => session), accountScopedSession: vi.fn(async () => session) } as unknown as ServiceRuntime
  const send = vi.fn(async (text: string) => {
    expect(store.project('prod:11', input.recordUid, text)?.kind).toBe('forward')
    return { sourceRef: 'target', itemUid: input.recordUid, status: 1, localState: 'synced' as const }
  })
  return { runtime, store, send }
}
it.each(['send_to_self', 'private_chat', 'group_chat'])('forwards only selection through ordinary delivery with optional comment to %s', async kind => {
  const { runtime, store, send } = fixture()
  await sendSelectedTextForward(runtime, input, { kind, ownerRef: 'target' }, send)
  const wire = selectedTextForwardWireText('', quote)
  expect(send).toHaveBeenCalledWith(wire, 11)
  const saved = store.project('prod:11', input.recordUid, wire)
  expect(saved).toMatchObject({ quote, noteText: '', kind: 'forward' })
  expect(selectedTextNotePresentation('edited original', saved)).toBeUndefined()
  expect(store.project('prod:12', input.recordUid, wire)).toBeUndefined()
})
it('separates comment and source and never accepts changed retry content or destination', async () => {
  const { runtime, store } = fixture(), send = vi.fn(async () => { throw new Error('timeout') }), data = { ...input, commentText: '自己的附言' }
  await expect(sendSelectedTextForward(runtime, data, { kind: 'group_chat', ownerRef: 'a' }, send)).rejects.toThrow('timeout')
  const wire = selectedTextForwardWireText(data.commentText, quote)
  expect(store.project('prod:11', input.recordUid, wire)).toMatchObject({ quote, noteText: '自己的附言' })
  expect(wire).toContain('引用 · 录音转写'); expect(wire).toContain('\n\n附言\n自己的附言')
  for (const [change, target] of [[{ ...data, commentText: 'changed' }, 'a'], [data, 'b']] as const) {
    await expect(sendSelectedTextForward(runtime, change, { kind: 'group_chat', ownerRef: target }, send)).rejects.toThrow('冻结')
  }
  expect(send).toHaveBeenCalledOnce()
})
it('blocks account changes, abort, unsupported targets, invalid selection and storage failure before delivery', async () => {
  const { runtime, store, send } = fixture(), target = { kind: 'private_chat', ownerRef: 'a' }
  await expect(sendSelectedTextForward(runtime, { ...input, expectedAccountKey: 'dev:11' }, target, send)).rejects.toMatchObject({ code: 'selected-text-account-changed' })
  await expect(sendSelectedTextForward(runtime, input, { kind: 'team', ownerRef: 'a' }, send)).rejects.toMatchObject({ code: 'selected-text-target-invalid' })
  await expect(sendSelectedTextForward(runtime, { ...input, quote: { ...quote, text: 'x'.repeat(2001) } }, target, send)).rejects.toMatchObject({ code: 'selected-text-invalid' })
  await expect(sendSelectedTextForward(runtime, input, target, send, AbortSignal.abort())).rejects.toThrow()
  vi.mocked(runtime.accountScopedSession).mockResolvedValueOnce(undefined)
  await expect(sendSelectedTextForward(runtime, input, target, send)).rejects.toMatchObject({ code: 'selected-text-account-changed' })
  vi.spyOn(store, 'prepare').mockImplementationOnce(() => { throw new Error('disk full') })
  await expect(sendSelectedTextForward(runtime, input, target, send)).rejects.toThrow('disk full')
  expect(send).not.toHaveBeenCalled()
})
it('does not acknowledge unknown receipts', async () => {
  const { runtime } = fixture()
  await expect(sendSelectedTextForward(runtime, input, { kind: 'send_to_self', ownerRef: '' }, async () => ({ itemUid: 'wrong', sourceRef: '', status: 1, localState: 'synced' }))).rejects.toMatchObject({ code: 'selected-text-unconfirmed' })
})
