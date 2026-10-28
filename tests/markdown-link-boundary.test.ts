// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { arkmeMarkdownExtensions, arkmePasteMarkdown, arkmeSerializeMarkdownEditor } from '../src/client/markdown-editor.js'

const url = 'https://example.com/share'
const editors: Editor[] = []
function create() {
  const editor = new Editor({ element: document.createElement('div'), extensions: arkmeMarkdownExtensions(), content: '' })
  editors.push(editor)
  return editor
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))
function type(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character, () => editor.state.tr.insertText(character, from, to)))
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to))
  }
}
function links(editor: Editor) {
  return Array.from(editor.view.dom.querySelectorAll('a')).map(a => ({ text: a.textContent, href: a.getAttribute('href') }))
}

describe('composer link continuation boundary', () => {
  it.each([' ', '   ', '\u3000', '\u00a0', '\t'])('ends a pasted URL at a %j separator before Chinese text', separator => {
    const editor = create()
    arkmePasteMarkdown(editor, url)
    type(editor, separator + '后续普通文字')
    expect(editor.getText()).toBe(url + separator + '后续普通文字')
    expect(links(editor)).toEqual([{ text: url, href: url }])
    expect(arkmeSerializeMarkdownEditor(editor).source).toContain(`](${url})${separator}后续普通文字`)
  })

  it('also exits for a native/composition text transaction without a keydown', () => {
    const editor = create()
    arkmePasteMarkdown(editor, url)
    editor.view.dispatch(editor.state.tr.insertText(' 后续说明').setMeta('composition', 1))
    expect(links(editor)).toEqual([{ text: url, href: url }])
    type(editor, '继续输入')
    expect(links(editor)).toEqual([{ text: url, href: url }])
  })

  it('keeps a deliberate spaced link title intact but does not extend it at the end', () => {
    const editor = create()
    arkmePasteMarkdown(editor, `[产品 文档](${url})`)
    type(editor, ' 查看说明')
    expect(links(editor)).toEqual([{ text: '产品 文档', href: url }])
  })

  it('detaches appended plain-text paste, but preserves explicitly pasted link titles', () => {
    const editor = create()
    arkmePasteMarkdown(editor, url)
    arkmePasteMarkdown(editor, '   粘贴的说明')
    expect(links(editor)).toEqual([{ text: url, href: url }])
    const other = create()
    arkmePasteMarkdown(other, `[产品](${url})`)
    arkmePasteMarkdown(other, `[ 使用 文档](${url})`)
    expect(links(other)).toEqual([{ text: '产品 使用 文档', href: url }])
  })

  it('preserves a whitespace-only paste and ends the inherited link before more typing', () => {
    const editor = create()
    arkmePasteMarkdown(editor, url)
    arkmePasteMarkdown(editor, '   ')
    type(editor, '说明')
    expect(links(editor)).toEqual([{ text: url, href: url }])
    expect(editor.getText()).toBe(url + '   说明')
  })

  it('allows spaces when editing inside a deliberate link title', () => {
    const editor = create()
    arkmePasteMarkdown(editor, `[产品文档](${url})`)
    editor.commands.setTextSelection(3)
    type(editor, ' 使用 ')
    expect(links(editor)).toEqual([{ text: '产品 使用 文档', href: url }])
  })

  it('does not change link formatting when restoring an existing draft', () => {
    const editor = create()
    const text = url + ' 原有链接标题'
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }] }] }
    editor.commands.setContent(document)
    expect(links(editor)).toEqual([{ text, href: url }])
    editor.commands.setContent({ ...document, content: [{ type: 'paragraph', content: [{ type: 'text', text: text + ' 继续保留', marks: [{ type: 'link', attrs: { href: url } }] }] }] }, { emitUpdate: false })
    expect(links(editor)).toEqual([{ text: text + ' 继续保留', href: url }])
  })

  it('ends a link even when ordinary text already follows it in the paragraph', () => {
    const editor = create()
    arkmePasteMarkdown(editor, `[文档](${url}) 原有说明`)
    editor.commands.setTextSelection(3)
    type(editor, ' 补充')
    expect(links(editor)).toEqual([{ text: '文档', href: url }])
    expect(editor.getText()).toBe('文档 补充 原有说明')
  })

  it('keeps ordinary formatting on the appended text', () => {
    const editor = create()
    arkmePasteMarkdown(editor, `**[文档](${url})**`)
    type(editor, ' 说明')
    expect(links(editor)).toEqual([{ text: '文档', href: url }])
    expect(editor.isActive('bold')).toBe(true)
    expect(editor.isActive('link')).toBe(false)
  })

  it('preserves undo/redo and the serialized send payload', () => {
    const editor = create()
    arkmePasteMarkdown(editor, url)
    editor.view.dispatch(closeHistory(editor.state.tr))
    type(editor, ' 说明')
    expect(links(editor)).toEqual([{ text: url, href: url }])
    editor.commands.undo()
    expect(editor.getText()).toBe(url)
    editor.commands.redo()
    expect(editor.getText()).toBe(url + ' 说明')
    expect(links(editor)).toEqual([{ text: url, href: url }])
    expect(arkmeSerializeMarkdownEditor(editor).source).toBe(`[${url}](${url}) 说明`)
  })

  it('does not carry link formatting across a paragraph break', () => {
    const editor = create()
    arkmePasteMarkdown(editor, url)
    editor.commands.splitBlock()
    type(editor, '下一行说明')
    expect(links(editor)).toEqual([{ text: url, href: url }])
    expect(editor.isActive('link')).toBe(false)
  })

  it('still recognizes a second independent URL after the separator', () => {
    const editor = create()
    arkmePasteMarkdown(editor, url)
    type(editor, ' 说明 https://example.org/ ')
    expect(links(editor)).toEqual([{ text: url, href: url }, { text: 'https://example.org/', href: 'https://example.org/' }])
  })
})
