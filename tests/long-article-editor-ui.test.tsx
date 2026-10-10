// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { closeHistory } from '@tiptap/pm/history'
import type { Editor } from '@tiptap/core'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleEditor } from '../src/client/ArkmeLongArticleEditor.js'

const mocks = vi.hoisted(() => ({ stage: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({
  stageLongArticleImage: mocks.stage,
  localFileUrl: (ref: string) => `/files/local?ref=${ref}`,
}) }))
let host: HTMLDivElement; let root: Root
const changed = vi.fn(); const error = vi.fn()
const getEditor = () => (host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
function paste(files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => '' } })
  act(() => getEditor().view.dom.dispatchEvent(event))
}
function image(name: string, size: number) {
  const file = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  changed.mockReset(); error.mockReset(); mocks.stage.mockReset()
  mocks.stage.mockImplementation(async (_file: File) => ({ fileRef: `arkme-file-v1.${crypto.randomUUID()}` }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<ArkmeLongArticleEditor initialSource="前文" disabled={false} onChange={changed} onError={error} resolveImage={() => undefined} />) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('rejects oversized images before staging or inserting and accepts other files in order', async () => {
  paste([image('large.png', 50 * 1024 * 1024 + 1), new File(['a'], 'first.png', { type: 'image/png' }), new File(['b'], 'second.png', { type: 'image/png' })])
  await settle()
  expect(mocks.stage.mock.calls.map(call => call[0].name)).toEqual(['first.png', 'second.png'])
  expect(error).toHaveBeenCalledWith(expect.stringContaining('large.png'))
  expect(changed.mock.lastCall![0].source).toContain('arkme-local:arkme-file-v1.')
  expect(changed.mock.lastCall![0].images).toHaveLength(2)
  expect(host.querySelectorAll('img[src^="/files/local"]')).toHaveLength(2)
})
it.each([10, 21, 100])('inserts %i images without using the ordinary attachment count', async count => {
  paste(Array.from({ length: count }, (_, i) => new File(['a'], `${i}.png`, { type: 'image/png' })))
  await settle()
  expect(mocks.stage).toHaveBeenCalledTimes(count)
  expect(changed.mock.lastCall![0].images).toHaveLength(count)
  expect(changed.mock.lastCall![0].pendingImages).toBe(0)
})
it('Enter splits a paragraph without publishing', () => {
  const editor = getEditor()
  act(() => { editor.commands.focus('end'); editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
  expect(editor.state.doc.childCount).toBe(2)
})
it('preserves a failed image position and retries it', async () => {
  mocks.stage.mockRejectedValueOnce(new Error('暂存失败'))
  paste([new File(['a'], 'retry.png', { type: 'image/png' })]); await settle()
  expect(changed.mock.lastCall![0].failedImages).toBe(1)
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === '重试')!
  await act(async () => button.click()); await settle()
  expect(changed.mock.lastCall![0].failedImages).toBe(0)
  expect(changed.mock.lastCall![0].images).toHaveLength(1)
})
it('undo and redo restore a staged image without uploading it again', async () => {
  paste([new File(['a'], 'undo.png', { type: 'image/png' })]); await settle()
  const source = changed.mock.lastCall![0].source
  act(() => { getEditor().commands.undo() })
  expect(changed.mock.lastCall![0].images).toHaveLength(0)
  act(() => { getEditor().commands.redo() })
  expect(changed.mock.lastCall![0].source).toBe(source)
  expect(changed.mock.lastCall![0].images).toHaveLength(1)
  expect(mocks.stage).toHaveBeenCalledTimes(1)
})
it('restores a durable image when staging finishes while its insertion is undone', async () => {
  let finish!: (value: { fileRef: string }) => void
  mocks.stage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  paste([new File(['a'], 'pending.png', { type: 'image/png' })]); await settle()
  act(() => { getEditor().commands.undo() })
  await act(async () => { finish({ fileRef: 'arkme-file-v1.11111111-1111-1111-1111-111111111111' }); await Promise.resolve() })
  act(() => { getEditor().commands.redo() })
  expect(changed.mock.lastCall![0].source).toContain('arkme-local:arkme-file-v1.11111111-1111-1111-1111-111111111111')
  expect(changed.mock.lastCall![0].failedImages).toBe(0)
})
it('rejects an image before staging when its durable reference cannot fit the document', async () => {
  act(() => { getEditor().commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a'.repeat(39980) }] }] }); getEditor().commands.setTextSelection(39981) })
  paste([new File(['a'], 'x.png', { type: 'image/png' })]); await settle()
  expect(mocks.stage).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith(expect.stringContaining('40000'))
})
it('marks only the failed upload in place without changing the saved document', async () => {
  paste([new File(['a'], 'first.png', { type: 'image/png' }), new File(['b'], 'second.png', { type: 'image/png' })])
  await settle()
  const draft = changed.mock.lastCall![0]
  const failedReferences = [`arkme-local:${draft.images[1].fileRef}`]
  await act(async () => { root.render(<ArkmeLongArticleEditor initialSource="前文" disabled={false} failedReferences={failedReferences} onChange={changed} onError={error} resolveImage={() => undefined} />) })
  const failure = host.querySelector('[data-upload-failure]')!
  expect(failure.textContent).toContain('上传失败')
  expect(failure.parentElement?.querySelector('img')?.alt).toBe('second.png')
  expect(host.querySelectorAll('[data-upload-failure]')).toHaveLength(1)
  expect(changed.mock.lastCall![0].source).toBe(draft.source)
})
it('inserts dropped images at the drop position in input order', async () => {
  const editor = getEditor()
  const coordinates = vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: editor.state.doc.content.size - 1, inside: 0 })
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: { value: { getData: () => '', files: [new File(['a'], 'drop-first.png', { type: 'image/png' }), new File(['b'], 'drop-second.png', { type: 'image/png' })] } },
    clientX: { value: 42 }, clientY: { value: 84 },
  })
  act(() => editor.view.dom.dispatchEvent(event))
  await settle()
  expect(coordinates).toHaveBeenCalledWith({ left: 42, top: 84 })
  expect(mocks.stage.mock.calls.map(call => call[0].name)).toEqual(['drop-first.png', 'drop-second.png'])
  const source = changed.mock.lastCall![0].source
  expect(source.indexOf('前文')).toBeLessThan(source.indexOf('drop-first'))
  expect(source.indexOf('drop-first')).toBeLessThan(source.indexOf('drop-second'))
})

it('clicking an image in an image-only article places a text caret after it without changing the document', () => {
  const editor = getEditor()
  act(() => editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'image', attrs: { src: 'arkme-local:first', alt: 'first' } },
    { type: 'image', attrs: { src: 'arkme-local:second', alt: 'second' } },
  ] }] }))
  const original = editor.getJSON()
  act(() => (host.querySelector('img') as HTMLImageElement).click())
  expect(document.activeElement).toBe(editor.view.dom)
  expect(editor.state.selection.constructor.name).toBe('TextSelection')
  expect(editor.state.selection.from).toBe(2)
  expect(editor.getJSON()).toEqual(original)
  act(() => { editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.insertContent('图片后输入') })
  expect(editor.state.doc.firstChild!.child(1).text).toBe('图片后输入')
  expect(editor.state.doc.firstChild!.lastChild!.attrs.src).toBe('arkme-local:second')
  act(() => editor.commands.undo())
  expect(editor.getJSON()).toEqual(original)
})

it('supports pasting and deleting images after clicking the last image', async () => {
  const editor = getEditor()
  act(() => editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'image', attrs: { src: 'arkme-local:first', alt: 'first' } },
  ] }] }))
  act(() => (host.querySelector('img') as HTMLImageElement).click())
  expect(editor.state.selection.from).toBe(2)
  paste([image('next.png', 1)])
  await settle()
  expect(changed.mock.lastCall![0].images).toEqual([{ fileRef: 'first' }, { fileRef: expect.any(String) }])
  act(() => (host.querySelector('img') as HTMLImageElement).click())
  act(() => { editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from }) })
  expect(changed.mock.lastCall![0].images).toHaveLength(1)
  act(() => editor.commands.undo())
  expect(changed.mock.lastCall![0].images).toHaveLength(2)
})

it.each(['markdown', 'saved draft'])('keeps image-only %s inside valid text paragraphs', async mode => {
  const src = 'arkme-asset:01a0a974-d704-786e-a13a-ab4818b2bb0d'
  const invalidDocument = { type: 'doc', content: Array.from({ length: 10 }, () => ({ type: 'image', attrs: { src, alt: '图片' } })) }
  await act(async () => root.render(<ArkmeLongArticleEditor key={mode} initialSource={Array.from({ length: 10 }, () => `![图片](${src})`).join('\n\n')} initialDocument={mode === 'saved draft' ? invalidDocument : undefined} disabled={false} onChange={changed} onError={error} resolveImage={() => '/test.png'} />))
  const editor = getEditor()
  expect(() => editor.state.doc.check()).not.toThrow()
  expect(editor.state.doc.childCount).toBe(10)
  act(() => (host.querySelectorAll('img[src]')[4] as HTMLImageElement).click())
  expect(editor.state.selection.$from.parent.isTextblock).toBe(true)
  expect(editor.state.selection.$from.nodeBefore!.type.name).toBe('image')
  act(() => editor.commands.insertContent('正文'))
  expect(editor.state.doc.child(4).textContent).toBe('正文')
  expect(host.querySelectorAll('img[src]')).toHaveLength(10)
})

it.each([{ x: 110, position: 1, label: 'before' }, { x: 290, position: 2, label: 'after' }])('places the caret $label the image based on the clicked half', ({ x, position }) => {
  const editor = getEditor()
  act(() => editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'image', attrs: { src: 'arkme-local:first', alt: 'first' } },
  ] }] }))
  const image = host.querySelector('img[src]') as HTMLImageElement
  const wrapper = image.parentElement!
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 200 } as DOMRect)
  const original = editor.getJSON()
  act(() => image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x })))
  expect(editor.state.selection.from).toBe(position)
  expect(document.activeElement).toBe(editor.view.dom)
  expect(editor.getJSON()).toEqual(original)
  expect(wrapper.style.display).toBe('inline-block')
  act(() => editor.commands.insertContent('文字'))
  expect(editor.state.doc.firstChild!.child(position === 1 ? 0 : 1).text).toBe('文字')
  expect(editor.state.doc.childCount).toBe(1)
})

function copySelection(type: 'copy' | 'cut' = 'copy') {
  const data = new Map<string, string>()
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    clearData: () => data.clear(), setData: (format: string, value: string) => data.set(format, value),
  } })
  act(() => getEditor().view.dom.dispatchEvent(event))
  return data.get('text/plain')
}

it('copies the whole article as Markdown with formatting, tables and image references', () => {
  const editor = getEditor()
  const source = '# 标题\n\n**加粗**和`code`\n\n- 项目\n\n> 引用\n\n```js\nconst n = 1\n```\n\n| 列 | 值 |\n| --- | --- |\n| A | B |\n\n![图片](arkme-asset:asset-1)'
  act(() => { editor.commands.setContent(source, { contentType: 'markdown' }); editor.commands.selectAll() })
  const before = editor.getJSON()
  const copied = copySelection()!
  expect(copied).toContain('# 标题')
  expect(copied).toContain('**加粗**')
  expect(copied).toContain('`code`')
  expect(copied).toMatch(/[-*] 项目/u)
  expect(copied).toContain('> 引用')
  expect(copied).toContain('```js\nconst n = 1\n```')
  expect(copied).toMatch(/\| A +\| B +\|/u)
  expect(copied).toContain('![图片](arkme-asset:asset-1)')
  expect(editor.getJSON()).toEqual(before)
})

it.each(['copy', 'cut'] as const)('%s serializes only selected text and preserves its marks', action => {
  const editor = getEditor()
  act(() => { editor.commands.setContent('前**加粗文字**后', { contentType: 'markdown' }); editor.commands.setTextSelection({ from: 2, to: 4 }) })
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.view.setProps({ handleScrollToSelection: () => true })
  expect(copySelection(action)).toBe('**加粗**')
  expect(editor.getText()).toBe(action === 'cut' ? '前文字后' : '前加粗文字后')
  if (action === 'cut') {
    act(() => editor.commands.undo())
    expect(editor.getText()).toBe('前加粗文字后')
  }
})

it('copies a selected image as its Markdown reference', () => {
  const editor = getEditor()
  act(() => { editor.commands.setContent('![图片](arkme-asset:asset-1)', { contentType: 'markdown' }); editor.commands.setNodeSelection(1) })
  expect(copySelection()).toBe('![图片](arkme-asset:asset-1)')
})
