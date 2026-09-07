// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { arkmeEditorProjection, arkmePasteMarkdown, arkmeMarkdownExtensions, arkmePlainEditorDocument, arkmeSerializeMarkdownEditor } from '../src/client/markdown-editor.js'
import { arkmeMarkdownEditorSource, arkmeMarkdownHashTagRanges, arkmeMarkdownPlainText, arkmeMarkdownTree } from '../src/markdown.js'
import { arkmeEmojiById } from '../src/client/arkme-emoji.js'

const editors: Editor[] = []
function create(content = '', markdown = true) {
  const editor = new Editor({ element: document.createElement('div'), extensions: arkmeMarkdownExtensions(),
    content: markdown ? arkmeMarkdownEditorSource(content) : arkmePlainEditorDocument(content),
    ...(markdown ? { contentType: 'markdown' as const } : {}),
  })
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

describe('quick note live Markdown', () => {
  it.each([
    '``a`b **粗体** #标签``',
    '```a``b `c` #标签```',
    '`` `边界` ``',
    '`` ` ``',
    '`  前后空格  `',
    '`   `',
    '`**原样** #代码 & < > \\`',
  ])('preserves inline code after paste and save: %s', source => {
    const editor = create()
    arkmePasteMarkdown(editor, source)
    const expected = editor.getJSON()
    const saved = arkmeSerializeMarkdownEditor(editor).source
    expect(create(saved).getJSON()).toEqual(expected)
    expect(arkmeMarkdownHashTagRanges(saved)).toEqual([])
    expect(arkmeMarkdownTree(saved).children?.[0]?.children).toMatchObject([
      { type: 'inlineCode', value: editor.getText() },
    ])
    expect(editor.getJSON()).toEqual(expected)
  })

  it('keeps mention ranges after inline code with backticks in the final UTF-16 source', () => {
    const editor = create()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '😀 a`b **粗体** #代码', marks: [{ type: 'code' }] },
      { type: 'text', text: ' ' },
      { type: 'arkmeMention', attrs: { mention: { mentionRef: 'opaque-user', displayName: '阿明', startIndex: 0, length: 0 } } },
    ] }] })
    const { source, mentions } = arkmeSerializeMarkdownEditor(editor)
    expect(mentions).toHaveLength(1)
    const mention = mentions[0]!
    expect(source.slice(mention.startIndex, mention.startIndex + mention.length)).toBe('@阿明')
    expect(arkmeMarkdownTree(source).children?.[0]?.children?.[0]).toMatchObject({
      type: 'inlineCode', value: '😀 a`b **粗体** #代码',
    })
    expect(arkmeMarkdownHashTagRanges(source)).toEqual([])
  })

  it('keeps inline code pipes inside one table cell after save', () => {
    const editor = create('| Code |\n| --- |\n| ``a`b \\| c #代码`` |')
    const saved = arkmeSerializeMarkdownEditor(editor).source
    expect(create(saved).getJSON()).toEqual(editor.getJSON())
    expect(arkmeMarkdownTree(saved).children?.[0]).toMatchObject({
      type: 'table', children: [
        { type: 'tableRow', children: [{ type: 'tableCell' }] },
        { type: 'tableRow', children: [{ type: 'tableCell', children: [{ type: 'inlineCode', value: 'a`b | c #代码' }] }] },
      ],
    })
    expect(arkmeMarkdownHashTagRanges(saved)).toEqual([])
  })

  it.each([
    { row: 0, backslashes: 1, expected: 'a|b' },
    { row: 0, backslashes: 2, expected: 'a\\\\|b' },
    { row: 1, backslashes: 1, expected: 'a|b' },
    { row: 1, backslashes: 2, expected: 'a\\\\|b' },
  ])('does not split table code with $backslashes backslashes in row $row', ({ row, backslashes, expected }) => {
    const editor = create('| Header |\n| --- |\n| Cell |')
    const document = editor.getJSON()
    const paragraph = document.content![0]!.content![row]!.content![0]!.content![0]!
    paragraph.content = [{ type: 'text', text: `a${'\\'.repeat(backslashes)}|b`, marks: [{ type: 'code' }] }]
    editor.commands.setContent(document)
    const saved = arkmeSerializeMarkdownEditor(editor).source
    const cells = arkmeMarkdownTree(saved).children?.[0]?.children?.[row]?.children
    expect(cells).toHaveLength(1)
    // GFM consumes the final escape before a pipe. With an odd literal run, retain
    // the existing normalization instead of introducing a column split and data loss.
    expect(cells?.[0]?.children).toMatchObject([{ type: 'inlineCode', value: expected }])
    const restoredRow = create(saved).state.doc.firstChild!.child(row)
    expect(restoredRow.childCount).toBe(1)
    expect(restoredRow.textContent).toBe(expected)
  })

  it.each(['```', '````', '~~~'])('keeps an embedded %s fence literal after paste and save', inner => {
    const editor = create()
    const code = `${inner}\n**原样** #代码`
    arkmePasteMarkdown(editor, `\`\`\`\`\`markdown\n${code}\n\`\`\`\`\``)
    const saved = arkmeSerializeMarkdownEditor(editor).source
    const restored = create(saved)
    expect(restored.state.doc.childCount).toBe(1)
    expect(restored.state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(restored.state.doc.firstChild?.textContent).toBe(code)
    expect(arkmeMarkdownHashTagRanges(saved)).toEqual([])
  })

  it('preserves code info strings containing backticks', () => {
    const editor = create('~~~lang`example\n# 原样\n~~~')
    const restored = create(arkmeSerializeMarkdownEditor(editor).source)
    expect(restored.state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(restored.state.doc.firstChild?.attrs.language).toBe('lang`example')
    expect(restored.state.doc.textContent).toBe('# 原样')
  })

  it('turns a typed Markdown link into linked text and keeps unsupported images literal', () => {
    const editor = create()
    type(editor, '[链接](https://example.com)')
    expect(editor.getText()).toBe('链接')
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toContainEqual(expect.objectContaining({ type: 'link', attrs: expect.objectContaining({ href: 'https://example.com' }) }))
    editor.commands.undoInputRule()
    expect(editor.getText()).toBe('[链接](https://example.com)')
    for (const literal of ['![图片](https://example.com/a.png)', '[链接](javascript:alert(1))']) {
      editor.commands.clearContent()
      type(editor, literal)
      expect(editor.getText()).toBe(literal)
    }
  })

  it('recognizes a heading and bold while typing, preserving undo', () => {
    const editor = create()
    type(editor, '# 标题')
    expect(editor.getJSON().content?.[0]?.type).toBe('heading')
    editor.commands.clearContent()
    type(editor, '**粗体**')
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('bold')
    editor.commands.undoInputRule()
    expect(editor.getText()).toBe('**粗体**')
  })

  it('keeps the complete GFM document through parse → edit → source → parse', () => {
    const source = '# 标题\n\n- [ ] 待办\n- [x] 完成\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 2 |\n\n~~删除~~ **粗体** `原样 #代码`\n\n```ts\nconst a = 1\n```'
    const editor = create(source)
    const saved = arkmeSerializeMarkdownEditor(editor)
    expect(saved.source).toContain('|')
    expect(saved.source).toContain('[x]')
    expect(create(saved.source).getJSON()).toEqual(editor.getJSON())
  })

  it('imports old plain text literally and preserves unsupported source on paste', () => {
    const source = '# 老笔记 **不加粗** <b>文字</b>'
    const editor = create(source, false)
    const saved = arkmeSerializeMarkdownEditor(editor)
    expect(create(saved.source).getText()).toBe(source)
    const unsupported = '<b>不是 HTML</b> ![图片](https://example.com/a.png)'
    expect(create(unsupported).getText()).toBe(unsupported)
    for (const literal of ['    四个空格', '\t制表符', '1. 原样编号', '---']) {
      expect(create(arkmeSerializeMarkdownEditor(create(literal, false)).source).getJSON()).toEqual(create(literal, false).getJSON())
    }
  })

  it('computes mentions from serialized UTF-16 source after emoji and nested formatting', () => {
    const emoji = Object.values(arkmeEmojiById)[0]!
    const editor = create()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [
      { type: 'text', text: '😀 中文 ' }, { type: 'arkmeEmoji', attrs: { emojiId: emoji.id } }, { type: 'text', text: ' ' },
      { type: 'arkmeMention', attrs: { mention: { mentionRef: 'opaque-user', displayName: '阿*明', startIndex: 0, length: 0 } } },
    ] }] })
    const { source, mentions } = arkmeSerializeMarkdownEditor(editor)
    expect(source).toContain(emoji.token)
    expect(mentions).toHaveLength(1)
    const mention = mentions[0]!
    expect(arkmeMarkdownPlainText(source.slice(mention.startIndex, mention.startIndex + mention.length))).toBe('@阿*明')
    const visible = arkmeEditorProjection(editor.state.doc)
    expect(visible.text).toBe('😀 中文 \uFFFC @阿*明')
    expect(visible.positions).toHaveLength(visible.text.length + 1)
    expect(mention.startIndex).toBeGreaterThan(visible.mentions[0]!.startIndex)
  })

  it('extracts tags only from Markdown text, excluding code, URLs and escaped hashes', () => {
    const source = '# 标题\n\n#真实 `#代码` [链接](https://example.com/#fragment) \\#普通\n\n```\n#不提取\n```'
    expect(arkmeMarkdownHashTagRanges(source).map(tag => tag.tag)).toEqual(['真实'])
  })
})
