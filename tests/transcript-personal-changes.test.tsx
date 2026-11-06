// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PersonalTranscriptEntry, TranscriptViewSavedPage } from '../src/transcript-view-contract.js'
import { TranscriptPersonalChanges, TranscriptCorrectionDetails } from '../src/client/TranscriptPersonalChanges.js'
import { connectArkmeLocale } from '../src/client/locale.js'

const mocks = vi.hoisted(() => ({
  call: vi.fn(), copy: vi.fn(),
  auth: { auth: { status: 'authenticated', userId: 11, environment: 'prod' } },
}))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { subscribe: () => () => {}, getSnapshot: () => mocks.auth } }))
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: mocks.copy }))
let root: Root, host: HTMLDivElement
const closed = vi.fn(), failed = vi.fn()
const saved = (id: string, text: string, original = '识别原文'): TranscriptViewSavedPage['items'][number] => ({
  kind: 'call', source_uid: 'call-source', segment_uid: id, original_version: 'v1',
  original, text, revision: 2, marks: [],
})
const page = (items: TranscriptViewSavedPage['items'], cursor = ''): TranscriptViewSavedPage => ({ historical: true, items, next_cursor: cursor })
const mark = { id: 'mark-1', state: 'available' as const, anchor: {
  version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: 'a'.repeat(64),
  start: 0, end: 2, text: '原文', prefix: '', suffix: '',
} }
const entry: PersonalTranscriptEntry = {
  revision: 1, original: '重复词，重复词。', text: '重复词，新词。', marks: [],
  originalVersion: 'v1', originalDigest: 'a'.repeat(64), originalChanged: false,
}
async function renderSource(sourceRef = 'source-a') {
  await act(async () => root.render(<TranscriptPersonalChanges sourceRef={sourceRef} onClose={closed} onFailure={failed} />))
}
async function click(text: string) {
  await act(async () => {
    const button = [...document.querySelectorAll('button')].find(element => element.textContent === text)
    expect(button, 'button ' + text).toBeDefined(); button!.click()
  })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.call.mockReset().mockResolvedValue(page([])); mocks.copy.mockReset().mockResolvedValue(undefined)
  closed.mockReset(); failed.mockReset()
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()
})

it('uses the shared modal, filters restored empty views and presents corrections and actual marked words without internal metadata', async () => {
  const marked = saved('mark', '原文只做标记', '原文只做标记'); marked.marks = [mark]
  mocks.call.mockResolvedValue(page([saved('restored', '已恢复的原文', '已恢复的原文'), saved('changed', '我更正后的文字'), marked]))
  await renderSource()
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.getAttribute('data-arkme-confirm-dialog')).toBe('true')
  expect(dialog.querySelector('[data-arkme-right-panel-header]')).not.toBeNull()
  expect(dialog.querySelectorAll('[data-transcript-personal-change]')).toHaveLength(2)
  expect(dialog.textContent).not.toContain('已恢复的原文')
  expect(dialog.textContent).toContain('我更正后的文字')
  expect(dialog.textContent).toContain('标记的文字')
  expect(dialog.querySelector('blockquote')?.textContent).toContain('原文')
  expect(dialog.textContent).not.toMatch(/历史快照|重分段|版本|0 个历史标记/)
  expect(dialog.textContent).not.toContain('恢复原文')
  expect(mocks.call).toHaveBeenCalledWith('transcript.views.saved', { accountKey: 'prod:11', ref: 'source-a', after: '' }, expect.any(AbortSignal))
  await click('复制文字'); expect(mocks.copy).toHaveBeenCalledWith('我更正后的文字')
})

it('retains continuation through an all-filtered page and retries the same failed cursor without duplicating requests', async () => {
  let reject!: (error: Error) => void
  mocks.call.mockResolvedValueOnce(page([saved('restored', '原文', '原文')], 'next'))
    .mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
    .mockResolvedValueOnce(page([saved('visible', '保留下来的更正')]))
  await renderSource(); expect(document.body.textContent).not.toContain('还没有更正或标记')
  await act(async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === '查看更多')!
    button.click(); button.click()
  })
  expect(mocks.call).toHaveBeenCalledTimes(2)
  await act(async () => reject(new Error('临时失败')))
  await click('重试')
  expect(mocks.call.mock.calls.map(([, params]) => params.after)).toEqual(['', 'next', 'next'])
  expect(document.body.textContent).toContain('保留下来的更正')
  expect(document.body.textContent).not.toContain('还没有更正或标记')
})

it('removes saved private text when pagination reports revoked source access', async () => {
  mocks.call.mockResolvedValueOnce(page([saved('one', '私人正文')], 'next'))
    .mockRejectedValueOnce(Object.assign(new Error('来源不可访问'), { body: { code: 'transcript-source-unavailable', httpStatus: 403 } }))
  await renderSource(); await click('查看更多')
  expect(document.body.textContent).not.toContain('私人正文')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('来源不可访问')
  expect(failed).toHaveBeenCalledOnce()
})

it('ignores a late previous-source reply while the newly opened source is still loading', async () => {
  let resolveA!: (value: TranscriptViewSavedPage) => void, resolveB!: (value: TranscriptViewSavedPage) => void
  mocks.call.mockImplementationOnce(() => new Promise(ok => { resolveA = ok }))
    .mockImplementationOnce(() => new Promise(ok => { resolveB = ok }))
  await renderSource('a'); const signalA = mocks.call.mock.calls[0]![2] as AbortSignal
  await renderSource('b'); expect(signalA.aborted).toBe(true)
  await act(async () => resolveA(page([saved('a', '旧来源私人文字')])))
  expect(document.body.textContent).not.toContain('旧来源私人文字')
  expect(document.querySelector('[role="status"]')?.textContent).toContain('正在读取')
  await act(async () => resolveB(page([saved('b', '当前来源更正')])))
  expect(document.body.textContent).toContain('当前来源更正')
})

it('allows closing a read-only pending modal, aborts its read and restores focus to its trigger', async () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  mocks.call.mockImplementation(() => new Promise(() => {}))
  await act(async () => root.render(<TranscriptPersonalChanges sourceRef="a" onClose={() => { root.render(null); closed() }} />))
  const signal = mocks.call.mock.calls[0]![2] as AbortSignal
  await act(async () => (document.querySelector('[aria-label="关闭我的修改"]') as HTMLButtonElement).click())
  expect(closed).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(true)
  expect(document.activeElement).toBe(trigger); trigger.remove()
})

it('keeps stale marks inspectable using their selected wording', async () => {
  const row = saved('old', '过去的个人更正')
  row.marks = [{ ...mark, state: 'stale', anchor: { ...mark.anchor, text: '之前选中的文字' } }]
  mocks.call.mockResolvedValue(page([row])); await renderSource()
  expect(document.querySelector('blockquote')?.textContent).toContain('之前选中的文字')
  expect(document.body.textContent).toContain('对应的文字已有变化')
})

it('retains correction details on restore failure, coalesces duplicate clicks and closes after a successful retry', async () => {
  let reject!: (error: Error) => void
  const restore = vi.fn().mockImplementationOnce(() => new Promise((_, no) => { reject = no })).mockResolvedValueOnce(undefined)
  await act(async () => root.render(<TranscriptCorrectionDetails entry={entry} onRestore={restore} onClose={closed} />))
  await act(async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === '恢复原文')!
    button.click(); button.click()
  })
  expect(restore).toHaveBeenCalledTimes(1)
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(closed).not.toHaveBeenCalled()
  await act(async () => reject(new Error('恢复失败')))
  expect(document.body.textContent).toContain('重复词，新词。'); expect(document.body.textContent).toContain('恢复失败')
  await click('恢复原文'); expect(restore).toHaveBeenCalledTimes(2); expect(closed).toHaveBeenCalledOnce()
})

it('compares only the supplied live wording and never substitutes a retained earlier projection', async () => {
  const snapshot = { ...entry, previousText: '更早保存的私人内容' }
  await act(async () => root.render(<TranscriptCorrectionDetails entry={snapshot} onRestore={vi.fn()} onClose={closed} />))
  expect(document.body.textContent).toContain(entry.original)
  expect(document.body.textContent).toContain(entry.text)
  expect(document.body.textContent).not.toContain(snapshot.previousText)
})

it('follows the shared language setting while leaving transcript wording untouched', async () => {
  let language = 'zh', changed = () => {}
  const disconnect = connectArkmeLocale({ getLocale: () => ({ active: language }), subscribe: listener => { changed = listener; return () => {} } })
  try {
    mocks.call.mockResolvedValue(page([saved('one', '我更正后的文字')]))
    await renderSource()
    await act(async () => { language = 'en'; changed() })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('My changes')
    expect(document.body.textContent).toContain('Copy text')
    expect(document.body.textContent).toContain('我更正后的文字')
    expect(document.querySelector('[aria-label="Close my changes"]')).not.toBeNull()
    await act(async () => root.render(<TranscriptCorrectionDetails entry={entry} onRestore={vi.fn()} onClose={closed} />))
    expect(document.body.textContent).toContain('Restore original')
    expect(document.body.textContent).toContain(entry.original)
    expect(document.body.textContent).toContain(entry.text)
  } finally {
    await act(async () => { language = 'zh'; changed() })
    disconnect()
  }
})
