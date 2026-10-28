// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/sdk/index.js', async original => ({ ...await original<typeof import('../src/sdk/index.js')>(), createArkmeSdk: () => ({}) }))
let element: HTMLDivElement, root: Root
const detail = { sourceRef: 'self', itemUid: 'article', title: '标题', textContent: '# 标题\n\n原始正文', textFormat: 'markdown', version: 1, editable: true, sendAtMillis: 1, editDurationMillis: 0 }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('scrollBy', () => {})
  mocks.call.mockReset().mockImplementation(async (op, p) => op === 'provider.capabilities' ? { features: { markdownLongArticles: true } }
    : op === 'source.long-article.detail' ? detail : op === 'source.long-article.update' ? { ...detail, ...p, version: p.version + 1 } : undefined)
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const writes = () => mocks.call.mock.calls.filter(([op]) => op === 'source.long-article.update')
async function mount() {
  await act(async () => root.render(<ArkmeLongArticleDialog sourceRef="self" item={{ itemUid: 'article', title: '标题', textContent: '', sendAtMillis: 1 }} onClose={() => {}}/>))
  const textbox = element.querySelector<HTMLElement>('.ProseMirror')! as HTMLElement & { editor: Editor }
  textbox.editor.view.setProps({ handleScrollToSelection: () => true }); return textbox
}
it('does not submit Markdown normalization alone and preserves the exact editor, caret and undo history after publishing', async () => {
  const textbox = await mount(), editor = textbox.editor
  await act(async () => vi.advanceTimersByTimeAsync(30_000)); expect(writes()).toHaveLength(0)
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.commands.insertContent('新增内容'); editor.view.focus() })
  const selection = editor.state.selection.toJSON()
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(writes()).toHaveLength(1)
  expect(writes()[0]![1]).toMatchObject({ textFormat: 'markdown', version: 1 })
  expect(element.querySelector('.ProseMirror')).toBe(textbox); expect(editor.isDestroyed).toBe(false)
  expect(editor.state.selection.toJSON()).toEqual(selection); expect(document.activeElement).toBe(textbox)
  expect(element.querySelector('[data-arkme-article-publication]')?.textContent).toBe('已发布')
  act(() => editor.commands.undo()); expect(textbox.textContent).not.toContain('新增内容')
  await act(async () => vi.advanceTimersByTimeAsync(5_000)); expect(writes()[1]![1].version).toBe(2)
})
it('does not publish a temporary edit that was fully undone before the idle deadline', async () => {
  const textbox = await mount(), editor = textbox.editor
  act(() => { editor.commands.insertContent('临时内容') })
  await act(async () => vi.advanceTimersByTimeAsync(300))
  act(() => { editor.commands.undo() })
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(writes()).toHaveLength(0)
  expect(mocks.call.mock.calls.some(([op]) => op === 'source.long-article.draft.delete')).toBe(true)
})
