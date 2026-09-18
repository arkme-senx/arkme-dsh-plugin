// @vitest-environment jsdom
import { act, createRef, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'
import { ArkmeComposerDraftStore } from '../src/client/composer-draft-store.js'
import type { ArkmeComposerSelectionRequest } from '../src/client/composer-selection-request.js'

let root: Root
let host: HTMLDivElement
let store: ArkmeComposerDraftStore
const handle = createRef<ArkmeRichComposerHandle>()
let insert: (name?: string) => void
let queue: (request: ArkmeComposerSelectionRequest) => void
let changeScope: () => void
let revision: () => void

function Harness({ markdown, initialRequest }: { markdown: boolean; initialRequest?: ArkmeComposerSelectionRequest }) {
  const [key, setKey] = useState('group:1')
  const [selection, setSelection] = useState<{ key: string; request: ArkmeComposerSelectionRequest } | undefined>(
    initialRequest ? { key: 'group:1', request: initialRequest } : undefined)
  const [, setRevision] = useState(0)
  const draft = useSyncExternalStore(store.subscribe, () => store.get(key))
  queue = request => setSelection({ key, request })
  revision = () => setRevision(value => value + 1)
  changeScope = () => setKey('group:2')
  insert = (name = '张三') => {
    const start = handle.current!.selectionStart
    const end = handle.current!.selectionEnd
    // A context-menu action takes focus away from the composer before it runs.
    host.querySelector<HTMLButtonElement>('button')!.focus()
    const cursor = store.insertMention(key, `member:${name}`, name, start, end)!
    queue({ text: store.get(key).text, start: cursor, end: cursor })
  }
  return <><button type="button">头像菜单</button><ArkmeRichComposerInput key={key}
    ref={handle} markdownEnabled={markdown} value={draft.text} mentions={draft.mentions} emojis={draft.emojis}
    markdown={draft.markdown} selectionRequest={selection?.key === key ? selection.request : undefined}
    maxLength={20000} disabled={false} style={{}} placeholder="群聊" ariaLabel="群聊"
    onTextChange={text => store.setText(key, text)}
    onMarkdownChange={(document, text, mentions, emojis) => store.setMarkdown(key, document, text, mentions, emojis)}
  /></>
}

function composer() { return host.querySelector<HTMLElement>('[data-arkme-rich-composer]')! }
function type(text: string) {
  act(() => {
    const node = composer() as HTMLElement & { editor?: Editor }
    if (node.editor) node.editor.view.dispatch(node.editor.state.tr.insertText(text))
    else {
      const selection = document.getSelection()!
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const inserted = document.createTextNode(text)
      range.insertNode(inserted)
      range.setStartAfter(inserted); range.collapse(true)
      selection.removeAllRanges(); selection.addRange(range)
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    }
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  store = new ArkmeComposerDraftStore({ getItem: () => null, setItem: () => {} })
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe.each([false, true])('external mention caret (markdown=%s)', markdown => {
  async function mount(text = '') {
    if (text) store.setText('group:1', text)
    await act(async () => { root.render(<Harness markdown={markdown} />) })
  }

  it.each([
    { text: '', start: 0, end: 0, expected: '@张三 ' },
    { text: '请看', start: 2, end: 2, expected: '请看@张三 ' },
    { text: '前后', start: 1, end: 1, expected: '前@张三 后' },
    { text: '前替换后', start: 1, end: 3, expected: '前@张三 后' },
  ])('places the caret after the mention in "$text"', async ({ text, start, end, expected }) => {
    await mount(text)
    act(() => { handle.current!.focus(); handle.current!.setSelectionRange(start, end) })
    // Draft insertion and caret request happen together, not in separate commits.
    act(() => insert())
    const cursor = start + '@张三 '.length
    expect(store.get('group:1').text).toBe(expected)
    expect(document.activeElement).toBe(composer())
    expect(handle.current!.selectionStart).toBe(cursor)
    expect(handle.current!.selectionEnd).toBe(cursor)
    type('你好')
    expect(store.get('group:1').text).toBe(expected.slice(0, cursor) + '你好' + expected.slice(cursor))
    expect(store.get('group:1').mentions[0]?.mentionRef).toBe('member:张三')
  })

  it('keeps consecutive mentions ordered and does not replay on later renders', async () => {
    await mount()
    act(() => insert())
    act(() => insert('李四'))
    expect(handle.current!.selectionStart).toBe(8)
    type('请看')
    expect(store.get('group:1').text).toBe('@张三 @李四 请看')
    act(() => { handle.current!.setSelectionRange(0, 0); revision() })
    expect(handle.current!.selectionStart).toBe(0)
  })

  it('does not steal focus after a conversation switch', async () => {
    await mount()
    act(() => { insert(); changeScope() })
    expect(store.get('group:1').text).toBe('@张三 ')
    expect(handle.current!.value).toBe('')
    expect(document.activeElement).toBe(host.querySelector('button'))
  })

  it('does not revive a stale request when its text appears again', async () => {
    await mount()
    act(() => { queue({ text: '@张三 ', start: 4, end: 4 }); store.setText('group:1', '其他草稿') })
    act(() => store.setText('group:1', '@张三 '))
    expect(document.activeElement).not.toBe(composer())
  })

  it('waits for a newly initialized editor before applying the request', async () => {
    const cursor = store.insertMention('group:1', 'member:张三', '张三', 0)!
    await act(async () => { root.render(<Harness markdown={markdown}
      initialRequest={{ text: store.get('group:1').text, start: cursor, end: cursor }} />) })
    expect(document.activeElement).toBe(composer())
    expect(handle.current!.selectionStart).toBe(cursor)
    type('继续')
    expect(store.get('group:1').text).toBe('@张三 继续')
  })
})
