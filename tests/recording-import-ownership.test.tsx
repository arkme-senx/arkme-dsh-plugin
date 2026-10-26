import { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ImportJournal, ImportQueueRecord } from '../src/client/recordings/recording-import-journal.js'

vi.mock('../src/client/api.js', () => ({
  callArkme: vi.fn(async (operation: string) => {
    if (operation === 'recordings.import.list') return { items: [], owner: { state: 'available' } }
    if (operation === 'recordings.import.preflight') return { duplicateFileNames: [] }
    if (operation === 'recordings.workflow') return { supported: false }
    throw new Error(`unexpected operation: ${operation}`)
  }),
  uploadArkmeRecording: vi.fn(), lookupArkmeRecordingImport: vi.fn(async () => null),
}))
vi.mock('../src/client/recordings/recording-import-selection.js', () => ({
  inspectArkmeRecordingSelection: vi.fn(async () => ({ ok: true, format: 'WAV', durationMillis: 1000 })),
}))

import { ArkmeRecordingImportDialog, type ArkmeRecordingImportDialogHandle } from '../src/client/recordings/ArkmeRecordingImportDialog.js'
import { uploadArkmeRecording } from '../src/client/api.js'

// Use Node 24's native Web Locks. Never replace queue ownership with a callback
// that lets every window become owner: that hid the actual browser deadlock.
const renderers: ReactTestRenderer[] = []
beforeEach(() => {
  vi.mocked(uploadArkmeRecording).mockReset().mockResolvedValue({
    kind: 'local', importRef: 'receipt', revision: 1, phase: 'accepted', ownership: 'self',
    fileName: 'sample.wav', fileSize: 4, durationMillis: 1000, startAtMillis: 1000,
    endAtMillis: 2000, progress: 1, status: 'completed', statusDetail: '已接收',
    createdAtMillis: 1, updatedAtMillis: 1,
  } as never)
})
afterEach(async () => { await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() }); vi.restoreAllMocks() })

function journal(): ImportJournal {
  const rows = new Map<string, ImportQueueRecord>()
  return {
    async list(account) { return [...rows.values()].filter(row => row.accountKey === account) },
    async change(upserts, removals) { removals.forEach(id => rows.delete(id)); upserts.forEach(row => rows.set(row.id, row)) },
  }
}
async function mount(accountKey: string, store: ImportJournal) {
  const ref = createRef<ArkmeRecordingImportDialogHandle>()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkmeRecordingImportDialog ref={ref} accountKey={accountKey} journal={store} importPath="/import" currentUserId={42} defaultStartAtMillis={1000} onAccepted={() => {}} />) })
  renderers.push(renderer)
  return { ref, renderer }
}
const picker = (renderer: ReactTestRenderer) => renderer.root.findByProps({ role: 'button' })
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function choose(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.onChange({ target: { files: [new File(['data'], 'sample.wav')], value: '' } })
  })
  await settle()
}
async function submit(renderer: ReactTestRenderer) {
  await act(async () => { renderer.root.findAll(node => node.type === 'button' && node.children.includes('导入'))[0]!.props.onClick() })
  await settle()
}

it('an idle mounted page does not block another window from selecting files', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal()
  const first = await mount(account, store)
  await settle()
  const second = await mount(account, store)
  await act(async () => { second.ref.current!.open() })
  await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(false)
  expect((await navigator.locks.query()).held?.filter(lock => lock.name === `arkme.recording-import:${account}`)).toHaveLength(1)
  expect(first.renderer.root.findByProps({ 'aria-label': '选择录音文件' }).props.disabled).toBe(true)
})

it('closing an idle panel hands off to the waiting window without closing the page', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal()
  const first = await mount(account, store)
  await act(async () => { first.ref.current!.open() })
  await settle()
  const second = await mount(account, store)
  await act(async () => { second.ref.current!.open() })
  await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(true)
  await act(async () => { first.ref.current!.close() })
  await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(false)
})

it('hands off saved candidates and restores the latest queue on reopening without uploading', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal()
  const first = await mount(account, store)
  await act(async () => { first.ref.current!.open() }); await settle(); await choose(first.renderer)
  const saved = await store.list(account)
  expect(saved).toHaveLength(1)
  const second = await mount(account, store)
  await act(async () => { second.ref.current!.open(); first.ref.current!.close() }); await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(false)
  expect(JSON.stringify(second.renderer.toJSON())).toContain('sample.wav')
  await act(async () => { second.ref.current!.close(); first.ref.current!.open() }); await settle()
  expect(picker(first.renderer).props['aria-disabled']).toBe(false)
  expect(await store.list(account)).toEqual(saved)
  expect(uploadArkmeRecording).not.toHaveBeenCalled()
})

it('continues the active upload after close, then releases ownership when the Host accepts it', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal()
  const response = await vi.mocked(uploadArkmeRecording).getMockImplementation()!('/import', new File([], 'sample.wav'), 1000, 42)
  const upload = Promise.withResolvers<typeof response>()
  vi.mocked(uploadArkmeRecording).mockReturnValueOnce(upload.promise)
  const first = await mount(account, store)
  await act(async () => { first.ref.current!.open() }); await settle(); await choose(first.renderer); await submit(first.renderer)
  expect(uploadArkmeRecording).toHaveBeenCalledTimes(1)
  const signal = vi.mocked(uploadArkmeRecording).mock.calls[0]![4]!.signal!
  const second = await mount(account, store)
  await act(async () => { first.ref.current!.close(); second.ref.current!.open() }); await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(true)
  expect(signal.aborted).toBe(false)
  await act(async () => { upload.resolve(response) }); await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(false)
  expect(await store.list(account)).toEqual([])
  expect(uploadArkmeRecording).toHaveBeenCalledTimes(1)
})

it('resumes a submitted journal entry in a hidden page and releases the queue afterwards', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal(), file = new File(['data'], 'sample.wav')
  await store.change([{ id: 'submitted', accountKey: account, fileName: file.name, fileSize: file.size,
    lastModified: file.lastModified, mimeType: file.type, source: { kind: 'file', file }, selected: true,
    startAt: '2026-10-26T10:00', ownership: 'self', submission: 'original-group', error: '' }], [])
  await mount(account, store); await settle()
  expect(uploadArkmeRecording).toHaveBeenCalledTimes(1)
  expect(vi.mocked(uploadArkmeRecording).mock.calls[0]![4]).toMatchObject({ clientTaskId: 'submitted' })
  expect(await store.list(account)).toEqual([])
  expect((await navigator.locks.query()).held?.filter(lock => lock.name === `arkme.recording-import:${account}`)).toEqual([])
})

it('does not release unsaved candidates or overwrite them with a stale persisted queue', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal()
  const first = await mount(account, store)
  await act(async () => { first.ref.current!.open() }); await settle()
  const change = vi.spyOn(store, 'change').mockRejectedValue(new Error('磁盘已满'))
  await choose(first.renderer)
  const second = await mount(account, store)
  await act(async () => { first.ref.current!.close(); second.ref.current!.open() }); await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(true)
  await act(async () => { first.ref.current!.open() }); await settle()
  expect(JSON.stringify(first.renderer.toJSON())).toContain('sample.wav')
  expect(JSON.stringify(first.renderer.toJSON())).toContain('队列尚未保存')
  change.mockRestore()
  await submit(first.renderer)
  await act(async () => { first.ref.current!.close() }); await settle()
  expect(picker(second.renderer).props['aria-disabled']).toBe(false)
  expect(uploadArkmeRecording).toHaveBeenCalledTimes(1)
})

it('retries a failed journal read when the user reopens the dialog', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal()
  vi.spyOn(store, 'list').mockRejectedValueOnce(new Error('队列存储暂不可用'))
  const first = await mount(account, store); await settle()
  expect(JSON.stringify(first.renderer.toJSON())).toContain('队列存储暂不可用')
  await act(async () => { first.ref.current!.open() }); await settle()
  expect(picker(first.renderer).props['aria-disabled']).toBe(false)
})

it('cancels an unmounted waiter without letting it claim or rewrite the queue later', async () => {
  const account = `test:${crypto.randomUUID()}`, store = journal()
  const first = await mount(account, store)
  await act(async () => { first.ref.current!.open() }); await settle()
  const waitingStore: ImportJournal = { list: vi.fn(async () => []), change: vi.fn(async () => {}) }
  const waiting = await mount(account, waitingStore)
  await act(async () => { waiting.ref.current!.open() }); await settle()
  await act(async () => { waiting.renderer.unmount(); first.ref.current!.close() }); await settle()
  expect(waitingStore.list).not.toHaveBeenCalled()
  expect(waitingStore.change).not.toHaveBeenCalled()
})
