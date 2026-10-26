// @vitest-environment jsdom
import { act, createRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { ArkmeDocumentComposerInput, type ArkmeDocumentComposerHandle } from '../src/client/ArkmeDocumentComposerInput.js'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'
import { ArkmeLongArticleEditor } from '../src/client/ArkmeLongArticleEditor.js'
import { mapDictationOffset, plainDictationTarget, type DictationTarget } from '../src/client/dictation-target.js'
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({}) }))
let host: HTMLDivElement, root: Root
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('maps a plain insertion through unrelated edits without losing original text', () => {
  let text = '前文后文'
  const target = plainDictationTarget({ read: () => text, at: 2, maxLength: 40, available: () => true, write: value => { text = value } })
  text = '新增前文后文'
  expect(target.insert('听写')).toBe(true); expect(text).toBe('新增前文听写后文')
  text += '手动'; target.insert('下一句'); expect(text).toBe('新增前文听写下一句后文手动')
  target.close(); expect(target.insert('旧响应')).toBe(false)
  expect(mapDictationOffset('abcdef', 'abXYef', 3)).toBe(4)
})
it.each(['plain', 'document'] as const)('inserts at the caret of the %s composer, preserving surrounding emoji and manual input', async kind => {
  const plain = createRef<ArkmeRichComposerHandle>(), document = createRef<ArkmeDocumentComposerHandle>()
  function View() {
    const [text, setText] = useState('前文后文')
    const common = { value: text, mentions: [], emojis: [], maxLength: 80, disabled: false, style: {}, placeholder: '', ariaLabel: '正文' }
    return kind === 'plain' ? <ArkmeRichComposerInput {...common} ref={plain} onTextChange={setText} />
      : <ArkmeDocumentComposerInput {...common} ref={document} format="text" onRichTextChange={setText} />
  }
  await act(async () => root.render(<View />))
  const handle = () => (kind === 'plain' ? plain : document).current!
  act(() => handle().setSelectionRange(2, 2))
  let target!: DictationTarget
  act(() => { target = handle().createDictationTarget!()!; expect(target.insert('语音')).toBe(true) })
  expect(handle().value).toBe('前文语音后文')
  act(() => { expect(target.insert('继续')).toBe(true) })
  expect(handle().value).toBe('前文语音继续后文')
  act(() => target.close())
})
it('long-article dictation keeps headings and images, maps manual edits, and participates in undo', async () => {
  const ref: { current: (() => DictationTarget | undefined) | undefined } = { current: undefined }
  const changed = vi.fn()
  await act(async () => root.render(<ArkmeLongArticleEditor initialSource={'# 标题\n\n正文\n\n![图](arkme-asset:asset-1)'} dictationTargetRef={ref} disabled={false} resolveImage={() => '/image.png'} onChange={changed} onError={() => {}} />))
  const editor = (host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor
  let target!: DictationTarget
  act(() => { editor.commands.setTextSelection(6); target = ref.current!()! })
  act(() => editor.view.dispatch(editor.state.tr.insertText('新增', 1)))
  act(() => { expect(target.insert('听写文字')).toBe(true) })
  expect(editor.view.dom.querySelector('h1')?.textContent).toBe('新增标题')
  expect(editor.view.dom.querySelector('img')).not.toBeNull()
  expect(changed.mock.lastCall![0].source).toContain('听写文字')
  act(() => target.close())
  expect(target.insert('过期')).toBe(false)
  act(() => editor.commands.undo())
  expect(editor.view.dom.textContent).not.toContain('听写文字')
})
it('a document length limit rejects dictation without truncating or overwriting existing text', async () => {
  const handle = createRef<ArkmeDocumentComposerHandle>()
  await act(async () => root.render(<ArkmeDocumentComposerInput ref={handle} format="text" value="保留原文" emojis={[]} maxLength={5} disabled={false} style={{}} placeholder="" ariaLabel="正文" onRichTextChange={() => {}} />))
  let target!: DictationTarget
  act(() => { target = handle.current!.createDictationTarget!()!; expect(target.insert('超过限制')).toBe(false) })
  expect(handle.current!.value).toBe('保留原文')
  act(() => target.close())
})
