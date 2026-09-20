// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'

vi.mock('../src/client/api.js', () => ({
  callArkme: async (operation: string) => {
    if (operation === 'provider.capabilities') return { features: { markdownLongArticles: true } }
    if (operation === 'source.long-article.detail') return { itemUid: 'article', title: '已有长文', textContent: '第一段正文', textFormat: 'markdown', version: 1, editable: true, editDurationMillis: 0 }
  },
}))
vi.mock('../src/sdk/index.js', async original => ({ ...await original<typeof import('../src/sdk/index.js')>(), createArkmeSdk: () => ({}) }))
let host: HTMLDivElement; let root: Root
const openedBackground = vi.fn()
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.unstubAllGlobals() })
it('keeps the editor focused after releasing a click inside the article portal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  // Reproduce ArkmeSidebar messageBubble's focus/open handler around the real portal owner.
  await act(async () => root.render(<div role="button" tabIndex={0} data-test-bubble onClick={event => {
    if (event.target instanceof Element && event.target.closest('button,a,audio,video,input,select,textarea,[role=link],[role=slider]')) return
    if (window.getSelection()?.toString()) return
    event.currentTarget.focus({ preventScroll: true }); openedBackground()
  }}><ArkmeMessageContent sourceRef="source" item={{ itemUid: 'article', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '已有长文', textContent: '第一段正文', textFormat: 'markdown', displayKind: 1 }} /></div>))
  await act(async () => (host.querySelector('[data-arkme-long-article="preview"]') as HTMLButtonElement).click())
  const dialog = document.querySelector('[role="dialog"]')!
  await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent?.includes('编辑'))!.click())
  const textbox = dialog.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
  expect(textbox).not.toBeNull()
  act(() => { textbox.editor.commands.setTextSelection(textbox.editor.state.doc.content.size - 1); textbox.editor.view.focus() })
  expect(document.activeElement).toBe(textbox)
  await act(async () => {
    const target = textbox.querySelector('p')!
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(openedBackground).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(textbox)
  act(() => textbox.editor.commands.insertContent('继续编辑'))
  expect(textbox.textContent).toContain('第一段正文继续编辑')
  expect(document.activeElement).toBe(textbox)
})

it('preserves the editor document, selection and undo history when the timeline refreshes the same item', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const item = { itemUid: 'article', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '已有长文', textContent: '第一段正文', textFormat: 'markdown' as const, displayKind: 1 as const }
  await act(async () => root.render(<ArkmeMessageContent sourceRef="source" item={item} />))
  await act(async () => (host.querySelector('[data-arkme-long-article="preview"]') as HTMLButtonElement).click())
  const dialog = document.querySelector('[role="dialog"]')!
  await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent?.includes('编辑'))!.click())
  const textbox = dialog.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }
  const editor = textbox.editor
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.commands.insertContent('未发布修改'); editor.view.focus() })
  const selection = editor.state.selection.toJSON()
  // Timeline read-state/media refresh emits a new object for the same record.
  await act(async () => root.render(<ArkmeMessageContent sourceRef="source" item={{ ...item, status: 2 }} />))
  expect(dialog.querySelector('.ProseMirror')).toBe(textbox)
  expect(editor.isDestroyed).toBe(false)
  expect(textbox.textContent).toContain('第一段正文未发布修改')
  expect(editor.state.selection.toJSON()).toEqual(selection)
  expect(document.activeElement).toBe(textbox)
  // jsdom has no layout API for scrolling a text selection.
  editor.view.setProps({ handleScrollToSelection: () => true })
  act(() => editor.commands.undo())
  expect(textbox.textContent).toBe('第一段正文')
})
