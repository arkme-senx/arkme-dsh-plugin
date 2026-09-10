// @vitest-environment jsdom
import { act, createRef, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { ArkmeMarkdownComposerInput } from '../src/client/ArkmeMarkdownComposerInput.js'
import { ArkmeMarkdownBody } from '../src/client/ArkmeMarkdownBody.js'
import { ArkmeEmojiPicker } from '../src/client/ArkmeEmojiPicker.js'
import type { ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'
import { arkmeEditorProjection, arkmeSerializeMarkdownEditor } from '../src/client/markdown-editor.js'
import { ArkmeComposerDraftStore, arkmeComposerCanSend, arkmeSourceComposerDraftKey, type ArkmeComposerDraftSnapshot } from '../src/client/composer-draft-store.js'

let root: Root
let host: HTMLDivElement
const initial: ArkmeComposerDraftSnapshot = { text: '', mentions: [], emojis: [], attachments: [] }
let snapshot = initial
let update: (value: ArkmeComposerDraftSnapshot) => void
let candidates = false
let inputActivity: string[] = []
let sent = 0
const handle = createRef<ArkmeRichComposerHandle>()
const draftKey = arkmeSourceComposerDraftKey(7, { kind: 'send_to_self', sourceRef: 'test' })!
let draftStore: ArkmeComposerDraftStore
let storage: Pick<Storage, 'getItem' | 'setItem'>
function Harness() {
  const [store] = useState(() => new ArkmeComposerDraftStore(storage))
  draftStore = store
  // Match the real sidebar's external store and callbacks, including empty-prefix updates.
  const draft = useSyncExternalStore(store.subscribe, () => store.get(draftKey))
  snapshot = draft
  update = value => { store.clear(draftKey); store.restore(draftKey, value) }
  return <ArkmeMarkdownComposerInput ref={handle} value={draft.text} mentions={draft.mentions} emojis={draft.emojis} markdown={draft.markdown}
    maxLength={20000} placeholder="快记" ariaLabel="快记" disabled={false} style={{}}
    onTextChange={text => store.setText(draftKey, text)}
    onInputActivity={text => { inputActivity.push(text) }}
    onMarkdownChange={(markdown, text, mentions, emojis) => store.setMarkdown(draftKey, markdown, text, mentions, emojis)}
    onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!candidates) sent++ } }} />
}
function editor(): Editor {
  return (host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
}
function type(text: string) {
  for (const character of text) act(() => {
    const value = editor()
    const { from, to } = value.state.selection
    const handled = value.view.someProp('handleTextInput', handler => handler(value.view, from, to, character, () => value.state.tr.insertText(character, from, to)))
    if (!handled) value.view.dispatch(value.state.tr.insertText(character, from, to))
  })
}
function key(options: KeyboardEventInit) {
  act(() => { editor().view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options })) })
}
function paste(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/plain' ? text : '', files: [] } })
  act(() => editor().view.dom.dispatchEvent(event))
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  candidates = false; sent = 0; inputActivity = []
  const memory = new Map<string, string>()
  storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) } }
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(<Harness />) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('Markdown composer DOM interaction', () => {
  it.each(['native DOMRect', 'plain rectangle'])('opens the emoji picker with %s caret coordinates and keeps navigation usable', async kind => {
    const coordinates = new DOMRect(120, 500, 0, 21)
    const rect = kind === 'native DOMRect' ? coordinates : {
      left: coordinates.left, right: coordinates.right, top: coordinates.top, bottom: coordinates.bottom,
    }
    const coordsAtPos = vi.spyOn(editor().view, 'coordsAtPos').mockReturnValue(rect)
    try {
      expect(handle.current!.getCaretGeometry()).toEqual({
        left: 120, right: 120, top: 500, bottom: 521, width: 0, height: 21,
      })
      const selected = vi.fn()
      const render = (scopeKey: string) => <><Harness /><ArkmeEmojiPicker
        disabled={false} scopeKey={scopeKey} onSelect={selected}
        getCaretGeometry={() => handle.current?.getCaretGeometry()}
        getEditorGeometry={() => handle.current?.getEditorGeometry()}
      /></>
      await act(async () => { root.render(render('chat:1')) })
      const toggle = () => act(() => { host.querySelector<HTMLButtonElement>('[aria-label="选择表情"]')!.click() })
      toggle()
      const panel = () => document.querySelector<HTMLElement>('[data-arkme-emoji-panel-shell]')
      expect(panel()?.style.visibility).toBe('visible')
      expect(document.querySelectorAll('[data-arkme-emoji-grid="default"] img')).toHaveLength(56)
      act(() => { document.querySelector<HTMLButtonElement>('[data-arkme-emoji-id="angry_face"]')!.click() })
      expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'angry_face' }))
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
      expect(panel()).toBeNull()
      toggle()
      await act(async () => { root.render(render('chat:2')) })
      expect(panel()).toBeNull()
      toggle()
      expect(panel()?.style.visibility).toBe('visible')
      expect(coordsAtPos.mock.calls.length).toBeGreaterThan(1)
    } finally { coordsAtPos.mockRestore() }
  })
  it('reports Markdown typing to the existing input activity owner', () => {
    type('甲乙')
    expect(inputActivity).toEqual(['甲', '甲乙'])
  })
  it.each([[1, '乙甲丙'], [2, '甲乙丙'], [3, '甲丙乙']])('pastes text inline at position %s', (position, expected) => {
    type('甲丙')
    act(() => editor().commands.setTextSelection(Number(position)))
    paste('乙')
    expect(snapshot.markdown?.source).toBe(expected)
    expect(editor().state.doc.childCount).toBe(1)
    act(() => editor().commands.undo())
    expect(snapshot.markdown?.source).toBe('甲丙')
    act(() => editor().commands.redo())
    expect(snapshot.markdown?.source).toBe(expected)
  })
  it('merges paragraph boundaries when pasting multiple plain paragraphs', () => {
    type('甲丙'); act(() => editor().commands.setTextSelection(2)); paste('乙\n\n丁')
    expect(snapshot.markdown?.source).toBe('甲乙\n\n丁丙')
  })
  it('pastes inline formatting inside the current paragraph and replaces the selection', () => {
    type('甲替换丙'); act(() => editor().commands.setTextSelection({ from: 2, to: 4 })); paste('**乙**')
    expect(editor().state.doc.childCount).toBe(1)
    expect(editor().getText()).toBe('甲乙丙')
    expect(host.querySelector('strong')?.textContent).toBe('乙')
  })
  it('preserves literal Markdown characters and line breaks when pasting inside code', () => {
    type('```'); key({ key: 'Enter', keyCode: 13, shiftKey: true }); paste('# 标题\n**代码**')
    expect(editor().state.doc.childCount).toBe(1)
    expect(editor().state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(editor().state.doc.textContent).toBe('# 标题\n**代码**')
    expect(snapshot.markdown?.source).toContain('# 标题\n**代码**')
  })
  it('keeps inline code literal and preserves spaces in ordinary paste', () => {
    type('`甲丙`'); act(() => editor().commands.setTextSelection(2)); paste('**乙**')
    expect(host.querySelector('code')?.textContent).toBe('甲**乙**丙')
    act(() => update(initial)); type('甲丙'); act(() => editor().commands.setTextSelection(2)); paste('  ')
    expect(editor().getText()).toBe('甲  丙')
  })
  it('renders saved inline code with embedded backticks without activating its formatting or tags', () => {
    paste('``a`b **粗体** #标签``')
    const text = 'a`b **粗体** #标签'
    expect(host.querySelector('code')?.textContent).toBe(text)
    const source = snapshot.markdown!.source
    act(() => root.render(<ArkmeMarkdownBody text={source} />))
    expect(host.querySelector('code')?.textContent).toBe(text)
    expect(host.querySelector('strong')).toBeNull()
    expect(host.querySelector('[role="link"]')).toBeNull()
  })
  it('retains explicit heading and task structures on document paste', () => {
    paste('# 标题\n\n- [ ] 待办')
    expect(host.querySelector('h1')?.textContent).toBe('标题')
    expect(host.querySelector('li[data-checked="false"] p')?.textContent).toBe('待办')
  })

  it('highlights the active hash and completed tags without adding formatting to the saved draft', () => {
    const original = editor()
    type('#')
    expect(host.querySelector('[data-arkme-editable-tag]')?.textContent).toBe('#')
    act(() => editor().commands.setTextSelection(1))
    expect(host.querySelector('[data-arkme-editable-tag]')).toBeNull()
    act(() => editor().commands.setTextSelection(2))
    type('项目 ')
    expect(host.querySelector('[data-arkme-editable-tag]')?.textContent).toBe('#项目')
    expect(snapshot.markdown?.source).toBe('#项目 ')
    expect(editor()).toBe(original)
    const saved = snapshot
    act(() => editor().commands.clearContent())
    act(() => update(saved))
    expect(host.querySelector('[data-arkme-editable-tag]')?.textContent).toBe('#项目')
    expect(snapshot.markdown?.document).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '#项目 ' }] }] })
  })

  it('replaces the highlighted hash with a heading when the user types a space', () => {
    type('#')
    expect(host.querySelector('[data-arkme-editable-tag]')?.textContent).toBe('#')
    type(' ')
    expect(host.querySelector('[data-arkme-editable-tag]')).toBeNull()
    expect(editor().state.selection.$from.parent.type.name).toBe('heading')
    type('标题')
    expect(snapshot.markdown?.source).toBe('# 标题')
  })

  it('keeps tag highlights out of code, links, URL fragments and escaped hashes', () => {
    type('#项目， **＃重点** #版本🚀 `#代码` [#链接](https://example.com/#地址) https://example.com/#片段 \\#普通')
    expect([...host.querySelectorAll('[data-arkme-editable-tag]')].map(node => node.textContent)).toEqual(['#项目', '＃重点', '#版本🚀'])
    expect(host.querySelector('strong')?.textContent).toBe('＃重点')
    expect(host.querySelector('code [data-arkme-editable-tag], a [data-arkme-editable-tag]')).toBeNull()
    act(() => editor().commands.clearContent())
    type('https://example.com/#片段')
    expect(host.querySelector('[data-arkme-editable-tag]')).toBeNull()
    act(() => editor().commands.clearContent())
    type('```')
    key({ key: 'Enter', keyCode: 13, shiftKey: true })
    type('#代码块')
    expect(host.querySelector('[data-arkme-editable-tag]')).toBeNull()
  })

  it.each([
    ['# ', 'h1'], ['## ', 'h2'], ['- ', 'ul:not([data-type="taskList"])'],
    ['1. ', 'ol'], ['> ', 'blockquote'], ['- [ ] ', 'li[data-checked="false"]'], ['- [x] ', 'li[data-checked="true"]'],
  ])('retains the empty %s structure in the real draft store before body text arrives', (prefix, selector) => {
    expect(host.querySelector('span[aria-hidden]')?.textContent).toBe('快记')
    type(prefix)
    expect(host.querySelector(selector), editor().getHTML()).not.toBeNull()
    expect(host.querySelector('span[aria-hidden]')).toBeNull()
    expect(snapshot.text).toBe('')
    expect(snapshot.markdown?.document).toEqual(editor().getJSON())
    expect(arkmeComposerCanSend(snapshot.text, 0, false)).toBe(false)
    expect(new ArkmeComposerDraftStore(storage).get(draftKey).markdown).toEqual(snapshot.markdown)
    type('正文')
    expect(host.querySelector(selector)?.textContent).toContain('正文')
    act(() => editor().commands.clearContent())
    expect(draftStore.get(draftKey).markdown).toBeUndefined()
    expect(host.querySelector('span[aria-hidden]')?.textContent).toBe('快记')
  })

  it('keeps an empty heading on the first line and restores the placeholder only after returning to a paragraph', () => {
    type('# ')
    expect(editor().state.doc.childCount).toBe(1)
    expect(editor().state.selection.$from.parent.type.name).toBe('heading')
    expect(getComputedStyle(host.querySelector('h1')!).marginTop).toBe('0px')
    type('标题')
    act(() => editor().commands.deleteRange({ from: 1, to: 3 }))
    expect(host.querySelector('h1')).not.toBeNull()
    expect(host.querySelector('span[aria-hidden]')).toBeNull()
    key({ key: 'Backspace', keyCode: 8 })
    expect(editor().state.doc.childCount).toBe(1)
    expect(editor().state.selection.$from.parent.type.name).toBe('paragraph')
    expect(host.querySelector('span[aria-hidden]')?.textContent).toBe('快记')
  })

  it.each(['```', '```ts', '~~~js'])('enters a code block with %s and Shift+Enter without sending', fence => {
    type(fence)
    key({ key: 'Enter', keyCode: 229, shiftKey: true, isComposing: true })
    expect(host.querySelector('pre')).toBeNull()
    key({ key: 'Enter', keyCode: 13, shiftKey: true })
    expect(host.querySelector('pre code')).not.toBeNull()
    expect(snapshot.text).toBe('')
    type('const answer = 42')
    key({ key: 'Enter', keyCode: 13, shiftKey: true })
    type('**literal**')
    expect(host.querySelector('pre code')?.textContent).toBe('const answer = 42\n**literal**')
    expect(sent).toBe(0)
  })

  it('keeps the editor instance and caret while typing, then honors Enter, candidates and IME', () => {
    const original = editor()
    type('# 标题')
    expect(host.querySelector('h1')?.textContent).toBe('标题')
    expect(editor()).toBe(original)
    expect(handle.current?.selectionStart).toBe(2)
    key({ key: 'Enter', keyCode: 13, shiftKey: true })
    type('下一行')
    expect(snapshot.markdown?.source).toBe('# 标题\n\n下一行')
    candidates = true; key({ key: 'Enter', keyCode: 13 }); expect(sent).toBe(0)
    candidates = false; key({ key: 'Enter', keyCode: 229, isComposing: true }); expect(sent).toBe(0)
    key({ key: 'Enter', keyCode: 13 }); expect(sent).toBe(1)
  })
  it('inserts an atomic mention into a heading without losing formatting and restores equal-text drafts', () => {
    type('# 标题 @')
    act(() => update({ ...initial, text: '标题 @阿明 ', mentions: [{ mentionRef: 'user', displayName: '阿明', startIndex: 3, length: 3 }] }))
    expect(host.querySelector('h1 [data-arkme-mention]')?.textContent).toBe('@阿明')
    expect(snapshot.markdown?.source).toBe('# 标题 @阿明 ')
    expect(snapshot.markdown?.mentions[0]?.startIndex).toBe(5)
    const heading = snapshot
    act(() => update({ ...snapshot, markdown: { document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: snapshot.text }] }] }, source: snapshot.text, mentions: [] } }))
    expect(host.querySelector('h1')).toBeNull()
    act(() => update(heading))
    expect(host.querySelector('h1 [data-arkme-mention]')).not.toBeNull()
  })
  it('pastes Markdown as formatted text and completes a typed table with Shift+Enter', () => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain' ? '**粘贴**' : '', files: [] } })
    act(() => editor().view.dom.dispatchEvent(event))
    expect(host.querySelector('strong')?.textContent).toBe('粘贴')
    act(() => update(initial))
    type('| 名称 | 数量 |')
    key({ key: 'Enter', keyCode: 13, shiftKey: true })
    type('| --- | --- |')
    key({ key: 'Enter', keyCode: 13, shiftKey: true })
    expect(host.querySelectorAll('th')).toHaveLength(2)
    expect(host.querySelectorAll('td')).toHaveLength(2)
    type('苹果')
    expect(host.querySelector('td')?.textContent).toBe('苹果')
    key({ key: 'Enter', keyCode: 13, shiftKey: true })
    type('表外正文')
    expect(editor().getJSON().content?.at(-1)?.type).toBe('paragraph')
    expect(snapshot.markdown?.source).toContain('\n\n表外正文')
    expect(sent).toBe(0)
  })
  it('persists text-only Markdown and restores a failed send with its document', () => {
    type('- [ ] 待办')
    expect(editor().getJSON().content?.[0]?.type, JSON.stringify(editor().getJSON())).toBe('taskList')
    const memory = new Map<string, string>()
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
    const key = arkmeSourceComposerDraftKey(7, { kind: 'group_chat', sourceRef: 'a' })!
    const store = new ArkmeComposerDraftStore(storage)
    const projection = arkmeEditorProjection(editor().state.doc)
    store.setMarkdown(key, arkmeSerializeMarkdownEditor(editor()), projection.text, projection.mentions, projection.emojis)
    const restored = new ArkmeComposerDraftStore(storage)
    expect(restored.get(key).markdown).toEqual(store.get(key).markdown)
    const sending = restored.take(key)
    restored.restore(key, sending)
    expect(restored.get(key).markdown?.source).toContain('- [ ] 待办')
  })
})
