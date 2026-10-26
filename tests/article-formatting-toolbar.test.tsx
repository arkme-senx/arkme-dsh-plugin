// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleEditor } from '../src/client/ArkmeLongArticleEditor.js'
import { arkmeMarkdownExtensions, arkmeSerializeMarkdownEditor } from '../src/client/markdown-editor.js'
import { Editor as TestEditor } from '@tiptap/core'
const mocks = vi.hoisted(() => ({ stage: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ stageLongArticleImage: mocks.stage, localFileUrl: () => '' }) }))
vi.mock('../src/client/ArkmeDshMenu.js', () => ({ ArkmeActionMenu: ({ open, actions, anchor, label }: any) => <>{anchor}{open && <div role="menu" aria-label={label}>{actions.filter((value: any) => value && !value.type).map((value: any) => <button role="menuitem" key={value.id} onClick={value.onSelect}>{value.label}</button>)}</div>}</> }))
let host: HTMLDivElement, root: Root, editor: Editor
const changed = vi.fn(), error = vi.fn(), dismiss: { current: (() => boolean) | undefined } = { current: undefined }
const box = (left = 0, top = 0, width = 800, height = 600) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} })
const toolbar = () => document.querySelector('[aria-label="长文格式工具栏"]')
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 2)) }) }
async function select(from = 1, to = 3) { await act(async () => { editor.commands.setTextSelection({ from, to }); editor.view.focus() }); await settle() }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { const id = setTimeout(() => fn(0), 0); return id as unknown as number })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) { return this.hasAttribute('data-arkme-article-format-floating') ? box(0, 0, 320, 44) as DOMRect : box() as DOMRect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [box(180, 200, 120, 25)] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => box(180, 200, 120, 25) })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  changed.mockReset(); error.mockReset(); host = document.createElement('div'); host.setAttribute('data-arkme-article-scroll', ''); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ArkmeLongArticleEditor initialSource="前文后文" disabled={false} dismissFormattingRef={dismiss} resolveImage={() => undefined} onChange={changed} onError={error}/>))
  editor = (host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (Range.prototype as any).getClientRects; delete (Range.prototype as any).getBoundingClientRect })
it('appears for a non-empty text selection and formats only that range with reversible Markdown', async () => {
  expect(toolbar()).toBeNull(); await select(); expect(toolbar()).not.toBeNull()
  await act(async () => button('加粗').click()); await settle()
  expect(changed.mock.lastCall![0].source).toBe('**前文**后文')
  expect(button('加粗').getAttribute('aria-pressed')).toBe('true')
  await act(async () => editor.commands.undo()); await settle()
  expect(arkmeSerializeMarkdownEditor(editor).source).toBe('前文后文')
  await act(async () => editor.commands.redo()); await settle()
  expect(arkmeSerializeMarkdownEditor(editor).source).toBe('**前文**后文')
})
it('retains a selection when a heading menu takes focus and formats its paragraph', async () => {
  await select(); await act(async () => button('段落格式').click())
  const heading = button('二级标题'); heading.focus()
  await act(async () => heading.click()); await settle()
  expect(arkmeSerializeMarkdownEditor(editor).source).toBe('## 前文后文')
  expect(editor.state.selection.from).not.toBe(editor.state.selection.to)
})
it('preserves the original selection while editing a link and blocks executable URLs', async () => {
  await select(); await act(async () => button('链接').click()); await settle()
  const field = document.querySelector<HTMLInputElement>('[aria-label="链接地址"]')!
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(field, 'javascript:alert(1)'); field.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => button('应用').click())
  expect(document.querySelector('[role=alert]')?.textContent).toContain('有效')
  expect(arkmeSerializeMarkdownEditor(editor).source).toBe('前文后文')
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(field, 'https://example.com'); field.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { button('应用').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); button('应用').click() }); await settle()
  expect(arkmeSerializeMarkdownEditor(editor).source).toBe('[前文](https://example.com/)后文')
  expect(editor.getText()).toBe('前文后文')
})
it('uses existing list, quote, code, and clearing commands and survives a save/reopen round trip', async () => {
  await select(); await act(async () => button('更多格式').click()); await act(async () => button('待办列表').click()); await settle()
  const source = arkmeSerializeMarkdownEditor(editor).source
  expect(source).toContain('- [ ] 前文后文')
  const restored = new TestEditor({ extensions: arkmeMarkdownExtensions({ articleImages: true }), content: source, contentType: 'markdown' })
  expect(restored.isActive('taskList')).toBe(true); expect(restored.getText()).toContain('前文后文'); restored.destroy()
})
it('Escape dismisses the toolbar, while collapsing the selection and disabling the editor remove it', async () => {
  await select(); await act(async () => { expect(dismiss.current!()).toBe(true) }); await settle(); expect(toolbar()).toBeNull()
  await select(2, 4); expect(toolbar()).not.toBeNull()
  await act(async () => editor.commands.setTextSelection(1)); await settle(); expect(toolbar()).toBeNull()
  await select(); await act(async () => root.render(<ArkmeLongArticleEditor initialSource="前文后文" disabled dismissFormattingRef={dismiss} resolveImage={() => undefined} onChange={changed} onError={error}/>)); await settle()
  expect(toolbar()).toBeNull()
})
it('keeps the drag path clear and hides a selected passage after it scrolls out of view', async () => {
  await select(); await act(async () => editor.view.dom.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))); await settle(); expect(toolbar()).toBeNull()
  await act(async () => document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))); await settle(); expect(toolbar()).not.toBeNull()
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [box(180, -100, 120, 25)] })
  await act(async () => host.dispatchEvent(new Event('scroll'))); await settle(); expect(toolbar()).toBeNull()
})
it.each([['斜体', '*前文*后文'], ['删除线', '~~前文~~后文'], ['行内代码', '`前文`后文']])('persists %s through Markdown save and reopen', async (label, expected) => {
  await select(); await act(async () => button(label).click()); await settle()
  expect(arkmeSerializeMarkdownEditor(editor).source).toBe(expected)
  const restored = new TestEditor({ extensions: arkmeMarkdownExtensions({ articleImages: true }), content: expected, contentType: 'markdown' })
  expect(arkmeSerializeMarkdownEditor(restored).source).toBe(expected); restored.destroy()
})
it.each([['无序列表', '- 前文后文'], ['有序列表', '1. 前文后文'], ['引用', '> 前文后文'], ['代码块', '```']])('applies %s without replacing paragraph content', async (label, prefix) => {
  await select(); await act(async () => button('更多格式').click()); await act(async () => button(label).click()); await settle()
  expect(arkmeSerializeMarkdownEditor(editor).source).toContain(prefix)
  expect(editor.getText()).toContain('前文后文')
})
it('inserts a divider after the selected text rather than replacing it', async () => {
  await select(); await act(async () => button('更多格式').click()); await act(async () => button('分隔线').click()); await settle()
  expect(editor.getText().replace(/\s/g, '')).toBe('前文后文')
  expect(arkmeSerializeMarkdownEditor(editor).source).toContain('---')
})
it('clears heading and inline formatting while retaining the entire text', async () => {
  await act(async () => editor.commands.setContent('## **前文**后文', { contentType: 'markdown' })); await select(1, 5)
  await act(async () => button('更多格式').click()); await act(async () => button('清除格式').click()); await settle()
  expect(arkmeSerializeMarkdownEditor(editor).source).toBe('前文后文')
})
it('retains embedded images when clearing the formatting of a mixed selection', async () => {
  await act(async () => editor.commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '前文', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'arkme-asset:one', alt: '保留图片' } }] },
    { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
  ] }))
  await select(1, editor.state.doc.content.size - 1)
  await act(async () => button('更多格式').click()); await act(async () => button('清除格式').click()); await settle()
  const source = arkmeSerializeMarkdownEditor(editor).source
  expect(source).toContain('![保留图片](arkme-asset:one)')
  expect(source).toContain('前文'); expect(source).toContain('后文'); expect(source).not.toContain('##')
})
it('offers table commands only inside a table and keeps existing cell text when inserting rows', async () => {
  await select(); await act(async () => button('更多格式').click()); expect(button('上方插入行')).toBeUndefined()
  await act(async () => { dismiss.current!(); editor.commands.setContent('| A | B |\n| --- | --- |\n| C | D |', { contentType: 'markdown' }) })
  let from = 0; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'C') from = pos })
  await select(from, from + 1); await act(async () => button('更多格式').click()); await act(async () => button('上方插入行').click()); await settle()
  expect(editor.getJSON().content?.[0]?.content).toHaveLength(3)
  for (const value of ['A', 'B', 'C', 'D']) expect(editor.getText()).toContain(value)
})
