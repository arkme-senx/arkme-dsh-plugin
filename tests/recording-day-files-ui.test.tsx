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
const changed = vi.fn(), countChanged = vi.fn()
const props = { accountKey: 'test:42', dateStamp: day, refreshRevision: 0, active: true, onChanged: changed, onCountChange: countChanged }
const render = async (patch = {}) => { await act(async () => root.render(<ArkmeRecordingFiles {...props} {...patch} />)) }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!
const click = async (text: string) => { await act(async () => button(text).click()) }
const openMenu = async (name = '会议.m4a') => { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="管理 ${name}"]`)!.click()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  changed.mockReset(); countChanged.mockReset(); completed = [file()]; current = []
  mock.call.mockReset().mockImplementation(async (operation: string, input: any) => {
    if (operation === 'recordings.import.list') return { items: current.slice(input.offset, input.offset + input.limit), owner: { state: 'available', hasMore: current.length > input.offset + input.limit, nextOffset: input.offset + input.limit } }
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

it('follows the selected recording day without a separate filter or search', async () => {
  completed = [file({ startAtMillis: day - 86400000, endAtMillis: day - 86340000 })]
  await render()
  expect(host.textContent).toContain('当天暂无音频文件')
  expect(host.querySelector('select, input[type="search"]')).toBeNull()
  expect(button('刷新')).toBeUndefined()
  expect(button('上传音频')).toBeUndefined()
  await render({ dateStamp: day - 86400000 })
  expect(host.textContent).toContain('会议.m4a')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day - 86400000, count: 1, complete: true, loading: false })
  await render({ dateStamp: day + 86400000 })
  expect(host.textContent).not.toContain('会议.m4a')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day + 86400000, count: 0, complete: true, loading: false })
})

it('only labels unfinished and failed files, with dates reserved for cross-day ranges', async () => {
  completed = [file(), file({ taskKey: 'overnight', fileName: '跨日.wav', startAtMillis: day - 60000, endAtMillis: day + 60000 })]
  current = [
    { ...file({ taskKey: 'active', fileName: '转写.wav', status: 'transcribing' }), kind: 'owner' },
    { ...file({ taskKey: 'failed', fileName: '失败.wav', status: 'failed', statusDetail: '转写失败' }), kind: 'owner' },
  ]
  await render()
  expect(host.textContent).not.toContain('已完成')
  expect(host.textContent).toContain('转写中')
  expect(host.textContent).toContain('失败')
  const sameDay = host.querySelector('[data-recording-file-key="one"]')!.textContent!
  expect(sameDay).toContain('00:00–00:01')
  expect(sameDay).toContain('1分钟')
  expect(sameDay).not.toContain('10/12')
  const crossDay = host.querySelector('[data-recording-file-key="overnight"]')!.textContent!
  expect(crossDay).toContain('10/11')
  expect(crossDay).toContain('10/12')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 4, complete: true, loading: false })
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

it('keeps the remaining rows, count and scroll position while deleting consecutive files without reloading', async () => {
  completed = [file(), file({ taskKey: 'two', sessionRef: 'ref2', fileName: '第二份.m4a', startAtMillis: day + 60000, endAtMillis: day + 120000 }), file({ taskKey: 'three', sessionRef: 'ref3', fileName: '第三份.m4a', startAtMillis: day + 120000, endAtMillis: day + 180000 })]
  await render()
  const remainingRow = host.querySelector('[data-recording-file-key="three"]')
  host.scrollTop = 120
  const readsBefore = mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.list' || operation === 'recordings.import.history').length
  await openMenu(); await click('删除文件'); await click('确认删除')
  expect(host.querySelector('[data-recording-file-key="three"]')).toBe(remainingRow)
  expect(host.scrollTop).toBe(120)
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 2, complete: true, loading: false })
  expect(document.activeElement?.getAttribute('aria-label')).toBe('管理 第二份.m4a')
  await openMenu('第二份.m4a'); await click('删除文件'); await click('确认删除')
  expect(host.querySelector('[data-recording-file-key="three"]')).toBe(remainingRow)
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: true, loading: false })
  expect(host.textContent).not.toContain('正在查找音频文件')
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.list' || operation === 'recordings.import.history')).toHaveLength(readsBefore)
  expect(changed).toHaveBeenCalledTimes(2)
})

it('does not resurrect a deleted file when an earlier current-task response arrives', async () => {
  let finishCurrent!: (value: unknown) => void
  mock.call.mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve }))
  await render(); await openMenu(); await click('删除文件'); await click('确认删除')
  await act(async () => finishCurrent({ items: [{ ...file(), kind: 'owner' }], owner: { state: 'available' } }))
  expect(host.textContent).not.toContain('会议.m4a')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 0, complete: true, loading: false })
})

it('keeps loaded rows usable during an external refresh and filters late deleted records', async () => {
  completed = [file(), file({ taskKey: 'two', sessionRef: 'ref2', fileName: '保留.m4a' })]
  await render()
  const remainingRow = host.querySelector('[data-recording-file-key="two"]')
  let finishHistory!: (value: unknown) => void
  const initialRead = mock.call.getMockImplementation()!
  mock.call.mockImplementation((operation, input) => operation === 'recordings.import.history'
    ? new Promise(resolve => { finishHistory = resolve }) : initialRead(operation, input))
  await render({ refreshRevision: 1 })
  expect(host.querySelector('[data-recording-file-key="two"]')).toBe(remainingRow)
  await openMenu(); await click('删除文件'); await click('确认删除')
  expect(host.querySelector('[data-recording-file-key="two"]')).toBe(remainingRow)
  // This response was captured before deletion and must be discarded.
  await act(async () => finishHistory({ items: completed, hasMore: false, offset: 0 }))
  expect(host.textContent).not.toContain('会议.m4a')
  expect(host.querySelector('[data-recording-file-key="two"]')).toBe(remainingRow)
  await act(async () => finishHistory({ items: [completed[1]], hasMore: false, offset: 0 }))
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: true, loading: false })
})

it('adjusts a failed page offset after deletion and retries without losing an unloaded file', async () => {
  completed = Array.from({ length: 501 }, (_, i) => file({ taskKey: `file${i}`, sessionRef: `ref${i}`, fileName: `${i}.wav` }))
  const initialRead = mock.call.getMockImplementation()!
  let failed = false
  mock.call.mockImplementation((operation, input) => {
    if (operation === 'recordings.import.history' && input.offset === 500 && !failed) {
      failed = true
      throw new Error('network unavailable')
    }
    return initialRead(operation, input)
  })
  await render()
  expect(button('继续查找更早文件')).toBeUndefined()
  const readCount = mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history').length
  await openMenu('0.wav'); await click('删除文件')
  completed.shift()
  await click('确认删除')
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history')).toHaveLength(readCount)
  await click('重试加载')
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history').at(-1)?.[1].offset).toBe(499)
  expect(host.querySelector('[data-recording-file-key="file500"]')).not.toBeNull()
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 500, complete: true, loading: false })
})

it('retries an in-flight page from the adjusted offset after deleting a preceding row', async () => {
  completed = Array.from({ length: 51 }, (_, i) => file({ taskKey: `file${i}`, sessionRef: `ref${i}`, fileName: `${i}.wav` }))
  const initialRead = mock.call.getMockImplementation()!
  let finishPage!: (value: unknown) => void
  mock.call.mockImplementation((operation, input) => operation === 'recordings.import.history' && input.offset === 50
    ? new Promise(resolve => { finishPage = resolve }) : initialRead(operation, input))
  await render()
  const oldPage = { items: completed.slice(50), hasMore: false, offset: 50 }
  await openMenu('0.wav'); await click('删除文件')
  completed.shift()
  await click('确认删除')
  await act(async () => finishPage(oldPage))
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history').map(([, input]) => input.offset)).toEqual([0, 50, 49])
  expect(host.querySelector('[data-recording-file-key="file0"]')).toBeNull()
  expect(host.querySelector('[data-recording-file-key="file50"]')).not.toBeNull()
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 50, complete: true, loading: false })
})

it.each(['success', 'failure'] as const)('pauses pagination while deletion is pending and resumes correctly after %s', async outcome => {
  completed = Array.from({ length: 51 }, (_, i) => file({ taskKey: `file${i}`, sessionRef: `ref${i}`, fileName: `${i}.wav` }))
  const initialRead = mock.call.getMockImplementation()!
  let finishPage!: (value: unknown) => void, finishDelete!: () => void, failDelete!: (reason: Error) => void, heldPage = false
  mock.call.mockImplementation((operation, input) => {
    if (operation === 'recordings.import.session.delete') return new Promise<void>((resolve, reject) => { finishDelete = resolve; failDelete = reject })
    if (operation === 'recordings.import.history' && input.offset === 50 && !heldPage) {
      heldPage = true
      return new Promise(resolve => { finishPage = resolve })
    }
    return initialRead(operation, input)
  })
  await render(); await openMenu('0.wav'); await click('删除文件'); await click('确认删除')
  if (outcome === 'success') completed.shift()
  // The server may already have deleted the file before acknowledging the write.
  await act(async () => finishPage({ items: completed.slice(50), offset: 50, hasMore: false }))
  expect(host.querySelector('[data-recording-file-key="file0"]')).not.toBeNull()
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history')).toHaveLength(2)
  await act(async () => { if (outcome === 'success') finishDelete(); else failDelete(new Error('删除失败')) })
  expect(host.querySelector('[data-recording-file-key="file50"]')).not.toBeNull()
  if (outcome === 'success') {
    expect(host.querySelector('[data-recording-file-key="file0"]')).toBeNull()
    expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 50, complete: true, loading: false })
  } else {
    expect(host.querySelector('[data-recording-file-key="file0"]')).not.toBeNull()
    expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 51, complete: true, loading: false })
    expect(changed).not.toHaveBeenCalled()
  }
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
  expect(host.textContent).not.toContain('当天暂无音频文件')
  await act(async () => resolve({ items: [], owner: { state: 'unavailable', message: 'offline' } }))
  expect(host.textContent).toContain('部分未完成文件暂未同步')
  expect(host.textContent).not.toContain('当天暂无音频文件')
})

it('loads every active-task page instead of truncating at twenty files', async () => {
  current = Array.from({ length: 55 }, (_, i) => ({ ...file({ taskKey: `active${i}`, sessionRef: `active${i}`, status: 'transcribing' }), kind: 'owner' }))
  await render()
  expect(host.textContent).not.toContain('当前仅显示最近任务')
  expect(host.querySelector('[data-recording-file-key="active54"]')).not.toBeNull()
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.list').map(([, input]) => input.offset)).toEqual([0, 50])
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 56, complete: true, loading: false })
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

it('automatically scans beyond five hundred files to find the selected day', async () => {
  completed = Array.from({ length: 501 }, (_, i) => file({ taskKey: `file${i}`, sessionRef: `ref${i}`, fileName: `${i}.wav`, startAtMillis: day - 86400000, endAtMillis: day - 86340000 }))
  completed[500] = file()
  await render()
  expect(mock.call.mock.calls.filter(call => call[0] === 'recordings.import.history')).toHaveLength(11)
  expect(button('继续查找更早文件')).toBeUndefined()
  expect(host.textContent).toContain('会议.m4a')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: true, loading: false })
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

it('can retry failed current-task reads without a permanent refresh toolbar', async () => {
  mock.call.mockRejectedValueOnce(new Error('未完成文件加载失败，请重试'))
  await render()
  expect(host.textContent).toContain('未完成文件加载失败')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: false, loading: false })
  await click('重试')
  expect(host.textContent).not.toContain('未完成文件加载失败')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: true, loading: false })
})


it('reuses completed history when returning to the tab and changing dates', async () => {
  await render()
  const reads = () => mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history')
  expect(reads()).toHaveLength(1)
  await render({ active: false })
  await render({ dateStamp: day + 86400000 })
  expect(reads()).toHaveLength(1)
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day + 86400000, count: 0, complete: true, loading: false })
  await render({ refreshRevision: 1 })
  expect(reads()).toHaveLength(2)
})

it('stops an automatic scan when leaving and resumes its last accepted page', async () => {
  completed = Array.from({ length: 101 }, (_, i) => file({ taskKey: `file${i}` }))
  const initialRead = mock.call.getMockImplementation()!
  let finishPage!: (value: unknown) => void, held = false
  mock.call.mockImplementation((operation, input) => {
    if (operation === 'recordings.import.history' && input.offset === 50 && !held) {
      held = true
      return new Promise(resolve => { finishPage = resolve })
    }
    return initialRead(operation, input)
  })
  await render()
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 50, complete: false, loading: true })
  const signal = mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history').at(-1)![2]
  await render({ active: false })
  expect(signal.aborted).toBe(true)
  await act(async () => finishPage({ items: completed.slice(50, 100), hasMore: true }))
  await render()
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history').map(([, input]) => input.offset)).toEqual([0, 50, 50, 100])
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 101, complete: true, loading: false })
})

it('stops a non-advancing history response and keeps loaded files available for retry', async () => {
  mock.call.mockImplementation(async operation => operation === 'recordings.import.history'
    ? { items: [file()], hasMore: true }
    : { items: [], owner: { state: 'available', hasMore: false } })
  await render()
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history')).toHaveLength(2)
  expect(host.textContent).toContain('会议.m4a')
  expect(host.textContent).toContain('未能继续加载')
  expect(button('重试加载')).toBeDefined()
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: false, loading: false })
})

it('restarts active pagination after deletion invalidates its in-flight offset', async () => {
  completed = []
  current = Array.from({ length: 51 }, (_, i) => ({ ...file({ taskKey: `active${i}`, sessionRef: `active${i}`, fileName: `${i}.wav`, status: 'transcribing' }), kind: 'owner' }))
  const initialRead = mock.call.getMockImplementation()!
  let finish!: (value: unknown) => void, held = false
  mock.call.mockImplementation((operation, input) => {
    if (operation === 'recordings.import.list' && input.offset === 50 && !held) {
      held = true
      return new Promise(resolve => { finish = resolve })
    }
    return initialRead(operation, input)
  })
  await render()
  await openMenu('0.wav'); await click('删除文件')
  current.shift()
  await click('确认删除')
  await act(async () => finish({ items: [], owner: { state: 'available', hasMore: false } }))
  expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.list').map(([, input]) => input.offset)).toEqual([0, 50, 0])
  expect(host.querySelector('[data-recording-file-key="active0"]')).toBeNull()
  expect(host.querySelector('[data-recording-file-key="active50"]')).not.toBeNull()
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 50, complete: true, loading: false })
})


it('refreshes expired history on re-entry instead of keeping a stale completed snapshot', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(day)
  try {
    await render()
    await render({ active: false })
    completed.push(file({ taskKey: 'new-file', fileName: '新文件.wav' }))
    now.mockReturnValue(day + 61_000)
    await render()
    expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history')).toHaveLength(2)
    expect(host.textContent).toContain('新文件.wav')
  } finally { now.mockRestore() }
})


it('refreshes history when a previously active file completes while the tab is hidden', async () => {
  completed = []
  current = [{ ...file({ status: 'transcribing' }), kind: 'owner' }]
  await render()
  await render({ active: false })
  current = []
  completed = [file()]
  await render()
  expect(host.textContent).toContain('会议.m4a')
  expect(host.textContent).not.toContain('转写中')
  expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: true, loading: false })
})


it('starts cache freshness when a slow scan finishes, not when it began', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(day)
  const initialRead = mock.call.getMockImplementation()!
  let finish!: (value: unknown) => void
  mock.call.mockImplementation((operation, input) => operation === 'recordings.import.history'
    ? new Promise(resolve => { finish = resolve }) : initialRead(operation, input))
  try {
    await render()
    now.mockReturnValue(day + 90_000)
    await act(async () => finish({ items: completed, hasMore: false }))
    await render({ active: false })
    now.mockReturnValue(day + 95_000)
    await render()
    expect(mock.call.mock.calls.filter(([operation]) => operation === 'recordings.import.history')).toHaveLength(1)
    expect(countChanged).toHaveBeenLastCalledWith({ dateStamp: day, count: 1, complete: true, loading: false })
  } finally { now.mockRestore() }
})
