// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'
import { ArkmeAttachmentStrip } from '../src/client/ArkmeAttachmentStrip.js'
import type { ArkmeComposerAttachment } from '../src/client/composer-draft-store.js'
import { focusArkmeComposerFromClick } from '../src/client/composer-focus.js'

let host: HTMLDivElement
let root: Root
const handle = createRef<ArkmeRichComposerHandle>()
const changed = vi.fn()

async function mount(markdown = false, disabled = false, scope = 'first') {
  await act(async () => root.render(<footer onClick={event => focusArkmeComposerFromClick(handle.current, event)}>
    <div data-blank="padding" />
    <div data-reference>引用原文可以选择复制</div>
    <ArkmeRichComposerInput key={scope} ref={handle} markdownEnabled={markdown}
      value="保留文字" mentions={[]} emojis={[]} maxLength={20000} placeholder="输入" ariaLabel="输入"
      disabled={disabled} style={{ minHeight: 38, height: 180 }} onTextChange={changed} onMarkdownChange={changed} />
    <div role="list"><span data-blank="attachments" /><button><svg><path /></svg></button></div>
    <div role="separator" tabIndex={0}><span>调整高度</span></div>
    <div data-arkme-composer-footer="tools"><button>发送</button><span>按钮间空白</span></div>
    <div data-arkme-composer-footer="hint"><span>Enter 发送</span></div>
    {createPortal(<div data-preview-portal>附件预览</div>, document.body)}
  </footer>))
  changed.mockClear()
}
const container = () => host.querySelector('footer')!
const editor = () => host.querySelector<HTMLElement>('[contenteditable]')!
function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  document.getSelection()?.removeAllRanges()
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('composer container click focus', () => {
  it('keeps real attachment preview, removal and keyboard ordering active inside the focus container', async () => {
    await mount()
    const attachments: ArkmeComposerAttachment[] = ['a.pdf', 'b.pdf'].map((fileName, index) => ({
      localFile: { fileRef: `arkme-file-v1.00000000-0000-4000-8000-00000000000${index + 1}`,
        fileName, fileKind: 4, mimeType: 'application/pdf', size: 10 },
    }))
    const preview = vi.fn(); const remove = vi.fn(); const move = vi.fn()
    await act(async () => root.render(<footer onClick={event => focusArkmeComposerFromClick(handle.current, event)}>
      <ArkmeRichComposerInput ref={handle} value="保留文字" mentions={[]} emojis={[]}
        maxLength={20000} placeholder="输入" ariaLabel="输入" disabled={false} style={{}} onTextChange={changed} />
      <ArkmeAttachmentStrip attachments={attachments} disabled={false}
        onPreview={preview} onRemove={remove} onMove={move} />
    </footer>))
    const focus = vi.spyOn(handle.current!, 'focus')
    click(host.querySelector('[aria-label="预览 a.pdf"]')!)
    click(host.querySelector('[aria-label="移除a.pdf"]')!)
    const item = host.querySelector<HTMLElement>('[role="listitem"]')!
    act(() => { item.focus(); item.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true,
    })) })
    expect(preview).toHaveBeenCalledExactlyOnceWith(attachments[0])
    expect(remove).toHaveBeenCalledExactlyOnceWith(attachments[0])
    expect(move).toHaveBeenCalledExactlyOnceWith(0, 1)
    expect(document.activeElement).toBe(item)
    expect(focus).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })

  it.each([false, true])('focuses the real editor from container and attachment whitespace (Markdown: %s)', async markdown => {
    await mount(markdown)
    for (const element of [container(), host.querySelector('[data-blank="padding"]')!, host.querySelector('[data-blank="attachments"]')!, editor().parentElement!]) {
      act(() => editor().blur())
      click(element)
      expect(document.activeElement).toBe(editor())
    }
    expect(changed).not.toHaveBeenCalled()
  })

  it.each([false, true])('focuses from toolbar whitespace while leaving its buttons alone (Markdown: %s)', async markdown => {
    await mount(markdown)
    const toolbar = host.querySelector('[data-arkme-composer-footer="tools"]')!
    click(toolbar.querySelector('span')!)
    expect(document.activeElement).toBe(editor())
    act(() => editor().blur())
    click(toolbar)
    expect(document.activeElement).toBe(editor())
    act(() => editor().blur())
    click(toolbar.querySelector('button')!)
    expect(document.activeElement).not.toBe(editor())
    expect(changed).not.toHaveBeenCalled()
  })

  it('excludes the complete shortcut hint, including its children and whitespace', async () => {
    await mount()
    const focus = vi.spyOn(handle.current!, 'focus')
    const region = host.querySelector('[data-arkme-composer-footer="hint"]')!
    for (const element of [region, ...region.querySelectorAll('*')]) click(element)
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(editor())
  })

  it.each([false, true])('leaves editor selection and already focused clicks alone (Markdown: %s)', async markdown => {
    await mount(markdown)
    act(() => { handle.current!.focus(); handle.current!.setSelectionRange(1, 3) })
    const focus = vi.spyOn(handle.current!, 'focus')
    click(editor().firstElementChild ?? editor())
    click(container())
    expect(focus).not.toHaveBeenCalled()
    expect([handle.current!.selectionStart, handle.current!.selectionEnd]).toEqual([1, 3])
    expect(changed).not.toHaveBeenCalled()
  })

  it('preserves attachment controls, nested SVG targets, candidates and resize interaction', async () => {
    await mount()
    const focus = vi.spyOn(handle.current!, 'focus')
    click(host.querySelector('path')!)
    click(host.querySelector('[role="separator"] span')!)
    for (const attributes of ['role="option"', 'role="menuitem"', 'draggable="true"', 'role="button"']) {
      const item = document.createElement('div')
      item.innerHTML = `<span ${attributes}><span>操作</span></span>`
      container().append(item)
      click(item.firstElementChild!.firstElementChild!)
    }
    expect(focus).not.toHaveBeenCalled()
  })

  it.each([false, true])('preserves selected reference text and resumes focus after selection collapses (Markdown: %s)', async markdown => {
    await mount(markdown)
    const reference = host.querySelector('[data-reference]')!
    const selection = document.getSelection()!
    const range = document.createRange()
    range.setStart(reference.firstChild!, 0)
    range.setEnd(reference.firstChild!, 4)
    selection.addRange(range)
    const focus = vi.spyOn(handle.current!, 'focus')
    click(reference)
    click(container())
    expect(focus).not.toHaveBeenCalled()
    expect(selection.toString()).toBe('引用原文')
    selection.collapse(reference.firstChild!, 4)
    click(host.querySelector('[data-blank="padding"]')!)
    expect(document.activeElement).toBe(editor())
    expect(changed).not.toHaveBeenCalled()
  })

  it('does not let a selection wholly outside the composer block whitespace focus', async () => {
    await mount()
    const outside = document.createElement('p')
    outside.textContent = '其他区域的原文'
    host.append(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    document.getSelection()!.addRange(range)
    click(container())
    expect(document.activeElement).toBe(editor())
  })

  it.each([false, true])('preserves selection crossing the composer boundary (backwards: %s)', async backwards => {
    await mount()
    const outside = document.createElement('p')
    outside.textContent = '其他区域'
    host.append(outside)
    const reference = host.querySelector('[data-reference]')!.firstChild!
    const selection = document.getSelection()!
    selection.setBaseAndExtent(backwards ? outside.firstChild! : reference, 0,
      backwards ? reference : outside.firstChild!, 2)
    const selectedText = selection.toString()
    const focus = vi.spyOn(handle.current!, 'focus')
    click(container())
    expect(focus).not.toHaveBeenCalled()
    expect(selection.toString()).toBe(selectedText)
  })

  it('leaves a real React Portal preview alone despite bubbling through the composer', async () => {
    await mount()
    const focus = vi.spyOn(handle.current!, 'focus')
    click(document.querySelector('[data-preview-portal]')!)
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(editor())
  })

  it('does not focus a disabled or missing editor, and resumes with the current handle after switching', async () => {
    await mount(false, true)
    click(container())
    expect(document.activeElement).not.toBe(editor())
    const oldEditor = editor()
    await mount(true, false, 'second')
    click(container())
    expect(document.activeElement).toBe(editor())
    expect(document.activeElement).not.toBe(oldEditor)
    expect(focusArkmeComposerFromClick(null, { currentTarget: container(), target: container(), button: 0, defaultPrevented: false })).toBe(false)
  })

  it('ignores handled events, right clicks and Portal targets outside its DOM', async () => {
    await mount()
    const focus = vi.spyOn(handle.current!, 'focus')
    const event = { currentTarget: container(), target: container(), button: 0, defaultPrevented: false }
    expect(focusArkmeComposerFromClick(handle.current, { ...event, defaultPrevented: true })).toBe(false)
    expect(focusArkmeComposerFromClick(handle.current, { ...event, button: 2 })).toBe(false)
    expect(focusArkmeComposerFromClick(handle.current, { ...event, target: document.body })).toBe(false)
    expect(focus).not.toHaveBeenCalled()
  })
})
