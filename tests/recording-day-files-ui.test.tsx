// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { PublicRecordingImportCurrentItem, PublicRecordingImportHistoryItem } from '../src/recording-import-shared.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mock.call }))
import { ArkmeRecordingFiles } from '../src/client/recordings/ArkmeRecordingFiles.js'

const day = new Date(2026, 9, 12).getTime()
const file = (patch: Partial<PublicRecordingImportHistoryItem> = {}): PublicRecordingImportHistoryItem => ({ taskKey: 'one', sessionRef: 'ref1', ownership: 'self', fileName: '会议.m4a', fileSize: 1048576, parsedSize: 100, durationMillis: 60000, startAtMillis: day, endAtMillis: day + 60000, progress: 1, status: 'completed', statusDetail: '', createdAtMillis: day, updatedAtMillis: day, ...patch })
let root: Root, host: HTMLDivElement
let completed: PublicRecordingImportHistoryItem[], current: PublicRecordingImportCurrentItem[]
const changed = vi.fn()
const props = { accountKey: 'test:42', dateStamp: day, refreshRevision: 0, active: true, onChanged: changed, onImport: vi.fn() }
const render = async (patch = {}) => { await act(async () => root.render(<ArkmeRecordingFiles {...props} {...patch} />)) }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!
const click = async (text: string) => { await act(async () => button(text).click()) }
const openMenu = async (name = '会议.m4a') => { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="管理 ${name}"]`)!.click()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  changed.mockReset(); completed = [file()]; current = []
  mock.call.mockReset().mockImplementation(async (operation: string, input: any) => {
    if (operation === 'recordings.import.list') return { items: current, owner: { state: 'available' } }
    if (operation === 'recordings.import.history') return { items: completed.slice(input.offset, input.offset + input.limit), hasMore: completed.length > input.offset + input.limit, offset: input.offset }
    return {}
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('continues beyond the first page to find an older day and includes active files', async () => {
  completed = Array.from({ length: 55 }, (_, i) => file({ taskKey: `other${i}`, sessionRef: `ref${i}`, fileName: `其他${i}`, startAtMillis: day - 86400000, endAtMillis: day - 86340000 }))
  completed.push(file())
  current = [{ ...file({ taskKey: 'active', sessionRef: 'active', fileName: '处理中.wav', status: 'transcribing' }), kind: 'owner' }]
  await render()
  expect(host.textContent).toContain('会议.m4a')
  expect(host.textContent).toContain('处理中.wav')
  expect(host.textContent).not.toContain('其他0')
  expect(mock.call.mock.calls.filter(call => call[0] === 'recordings.import.history').map(call => call[1].offset)).toEqual([0, 50])
})

it('switches to upload date and keeps files accessible even if they belong to another recording day', async () => {
  completed = [file({ startAtMillis: day - 86400000, endAtMillis: day - 86340000 })]
  await render()
  expect(host.textContent).toContain('当前范围没有音频文件')
  await act(async () => { const select = host.querySelector('select')!; select.value = 'uploaded'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(host.textContent).toContain('会议.m4a')
  expect(host.textContent).toContain('不是上传完成时间')
  await render({ dateStamp: day + 86400000 })
  expect(host.textContent).not.toContain('会议.m4a')
})

it('only deletes after confirmation, and refreshes the parent after success', async () => {
  await render(); await openMenu(); await click('删除文件')
  expect(mock.call.mock.calls.some(call => call[0].endsWith('.delete'))).toBe(false)
  expect(document.querySelector('dialog')?.textContent).toContain('跨日部分也会受影响')
  await click('取消')
  expect(changed).not.toHaveBeenCalled()
  await openMenu(); await click('删除文件')
  completed = []
  await click('确认删除')
  expect(mock.call).toHaveBeenCalledWith('recordings.import.session.delete', { sessionRef: 'ref1' }, expect.any(AbortSignal))
  expect(changed).toHaveBeenCalledOnce()
  expect(host.textContent).not.toContain('会议.m4a')
})

it('keeps a failed deletion reviewable without claiming success or refreshing parent data', async () => {
  await render(); await openMenu(); await click('删除文件')
  mock.call.mockRejectedValueOnce(new Error('删除失败'))
  await click('确认删除')
  expect(document.querySelector('dialog[open]')?.textContent).toContain('删除失败')
  expect(host.textContent).toContain('会议.m4a')
  expect(changed).not.toHaveBeenCalled()
})

it('updates time and ownership using existing owner operations', async () => {
  await render(); await openMenu(); await click('修改录音时间')
  await click('保存')
  expect(mock.call).toHaveBeenCalledWith('recordings.import.session.update-start', { sessionRef: 'ref1', startAtMillis: day }, expect.any(AbortSignal))
  await openMenu(); await click('修改数据归属')
  await act(async () => { const select = document.querySelector<HTMLSelectElement>('[aria-label="文件数据归属"]')!; select.value = 'other'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await click('保存')
  expect(mock.call).toHaveBeenCalledWith('recordings.import.session.update-ownership', { sessionRef: 'ref1', ownership: 'other' }, expect.any(AbortSignal))
  expect(changed).toHaveBeenCalledTimes(2)
})

it('never reports an empty complete list while current tasks are pending or unavailable', async () => {
  completed = []
  let resolve!: (v: unknown) => void
  mock.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await render()
  expect(host.textContent).not.toContain('当前范围没有音频文件')
  await act(async () => resolve({ items: [], owner: { state: 'unavailable', message: 'offline' } }))
  expect(host.textContent).toContain('部分未完成文件暂未同步')
  expect(host.textContent).not.toContain('当前范围没有音频文件')
})

it('warns when the active task source may be truncated instead of claiming a complete count', async () => {
  current = Array.from({ length: 20 }, (_, i) => ({ ...file({ taskKey: `active${i}`, sessionRef: `active${i}`, status: 'transcribing' }), kind: 'owner' }))
  await render()
  expect(host.textContent).toContain('当前仅显示最近任务')
  expect(host.textContent).toContain('已找到 21 个文件')
  expect(host.textContent).not.toContain('共 21 个文件')
})

it('cancels an unfinished local upload with its revision only after confirmation', async () => {
  completed = []
  current = [{ ...file(), kind: 'local', importRef: 'local-ref', revision: 7, phase: 'uploading', status: 'uploading' }]
  await render(); await openMenu()
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('修改录音时间')
  await click('删除文件')
  expect(mock.call.mock.calls.some(call => call[0] === 'recordings.import.cancel')).toBe(false)
  current = []
  await click('确认删除')
  expect(mock.call).toHaveBeenCalledWith('recordings.import.cancel', { importRef: 'local-ref', expectedRevision: 7 }, expect.any(AbortSignal))
  expect(changed).toHaveBeenCalledOnce()
  expect(host.textContent).not.toContain('会议.m4a')
})

it('bounds background history scanning, exposes continuation and never labels partial results complete', async () => {
  completed = Array.from({ length: 501 }, (_, i) => file({ taskKey: `file${i}`, sessionRef: `ref${i}`, fileName: `${i}.wav`, startAtMillis: day - 86400000, endAtMillis: day - 86340000 }))
  completed[500] = file()
  await render()
  expect(mock.call.mock.calls.filter(call => call[0] === 'recordings.import.history')).toHaveLength(10)
  expect(host.textContent).toContain('列表尚未查全')
  await click('继续查找更早文件')
  expect(host.textContent).toContain('会议.m4a')
  expect(host.textContent).toContain('共 1 个文件')
})

it('discards late data and action dialogs on account changes', async () => {
  let resolve!: (v: unknown) => void
  mock.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await render(); await openMenu(); await click('删除文件')
  completed = []
  await render({ accountKey: 'prod:43' })
  await act(async () => resolve({ items: [{ ...file(), kind: 'owner' }], owner: { state: 'available' } }))
  expect(document.querySelector('dialog')).toBeNull()
  expect(host.textContent).not.toContain('会议.m4a')
  expect(mock.call.mock.calls.some(call => call[0].endsWith('.delete'))).toBe(false)
})
