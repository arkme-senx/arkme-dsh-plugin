// @vitest-environment jsdom
import { act, createRef, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'
import { useComposerPasteFocus } from '../src/client/composer-paste-focus.js'
import type { ArkmeComposerSelectionRequest } from '../src/client/composer-selection-request.js'

let host: HTMLDivElement, root: Root
const handle = createRef<ArkmeRichComposerHandle>()
let begin: () => void, finish: () => void, switchScope: () => void, switchGeneration: () => void
let setText: (text: string) => void, rerender: () => void

function Harness({ markdown, nativeDialog = false, withOwnedDialog = false }: { markdown: boolean; nativeDialog?: boolean; withOwnedDialog?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const owned = useRef<HTMLDivElement>(null)
  const [scope, setScope] = useState({})
  const [generation, setGeneration] = useState(0)
  const [value, updateText] = useState('前后')
  const [disabled, setDisabled] = useState(false)
  const [request, setRequest] = useState<ArkmeComposerSelectionRequest>()
  const [, setRevision] = useState(0)
  const capture = useComposerPasteFocus({ scope, generation, active: true, container, editor: handle, onReady: setRequest })
  begin = () => {
    const ready = capture({ nativeDialog, ...(withOwnedDialog ? { ownedDialog: () => owned.current } : {}) })
    setRequest(undefined)
    setDisabled(true)
    finish = () => { setDisabled(false); ready() }
  }
  switchScope = () => setScope({})
  switchGeneration = () => setGeneration(value => value + 1)
  setText = updateText
  rerender = () => setRevision(value => value + 1)
  return <><button type="button">外部按钮</button><div ref={container}>
    <ArkmeRichComposerInput ref={handle} markdownEnabled={markdown} value={value}
      mentions={[]} emojis={[]} maxLength={20000} disabled={disabled} style={{}}
      placeholder="输入" ariaLabel="输入" selectionRequest={disabled ? undefined : request}
      onTextChange={updateText} onMarkdownChange={(_document, text) => updateText(text)} />
  </div><div data-outside>非聚焦区域</div>{withOwnedDialog && disabled && <div ref={owned} data-owned><button>完成裁剪</button></div>}</>
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const editor = () => host.querySelector<HTMLElement>('[data-arkme-rich-composer]')!
const blur = () => { act(() => editor().blur()) }

it.each([false, true])('restores the original caret after interacting with an owned crop dialog (markdown=%s)', async markdown => {
  await act(async () => root.render(<Harness markdown={markdown} nativeDialog withOwnedDialog />))
  act(() => { handle.current!.focus(); handle.current!.setSelectionRange(1, 1) })
  act(begin)
  act(() => {
    const button = host.querySelector<HTMLButtonElement>('[data-owned] button')!
    button.focus()
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  })
  act(finish)
  expect(document.activeElement).toBe(editor())
  expect(handle.current!.selectionStart).toBe(1)
})

it.each([false, true])('restores selection after a native screenshot dialog (markdown=%s)', async markdown => {
  await act(async () => root.render(<Harness markdown={markdown} nativeDialog />))
  act(() => { handle.current!.focus(); handle.current!.setSelectionRange(1, 1) })
  act(begin); blur()
  act(() => window.dispatchEvent(new Event('blur')))
  act(finish)
  expect(document.activeElement).toBe(editor())
  expect(handle.current!.selectionStart).toBe(1)
})

it('native dialog focus restoration still respects a later conversation change', async () => {
  await act(async () => root.render(<Harness markdown nativeDialog />))
  act(() => handle.current!.focus())
  act(begin); blur()
  act(() => { window.dispatchEvent(new Event('blur')); switchScope() })
  act(finish)
  expect(document.activeElement).not.toBe(editor())
})

describe.each([false, true])('paste focus (markdown=%s)', markdown => {
  async function mount(start = 1, end = start) {
    await act(async () => root.render(<Harness markdown={markdown} />))
    act(() => { handle.current!.focus(); handle.current!.setSelectionRange(start, end) })
  }
  it.each([[1, 1], [0, 2]])('restores the original selection %s..%s after staging', async (start, end) => {
    await mount(start, end)
    act(begin); blur()
    expect(handle.current!.disabled).toBe(true)
    act(finish)
    expect(document.activeElement).toBe(editor())
    expect(handle.current!.selectionStart).toBe(start)
    expect(handle.current!.selectionEnd).toBe(end)
    act(() => { handle.current!.setSelectionRange(0, 0); rerender() })
    expect(handle.current!.selectionStart).toBe(0)
  })
  it.each(['outside-focus', 'outside-click', 'inside-click', 'Tab', 'Escape', 'window-blur', 'conversation', 'reedit', 'changed-text'])('does not steal focus after %s', async action => {
    await mount(); act(begin); blur()
    act(() => {
      if (action === 'outside-focus') host.querySelector('button')!.focus()
      if (action === 'outside-click') host.querySelector('[data-outside]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      if (action === 'inside-click') editor().dispatchEvent(new Event('pointerdown', { bubbles: true }))
      if (action === 'Tab' || action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: action, bubbles: true }))
      if (action === 'window-blur') window.dispatchEvent(new Event('blur'))
      if (action === 'conversation') switchScope()
      if (action === 'reedit') switchGeneration()
      if (action === 'changed-text') setText('其他草稿')
    })
    act(finish)
    expect(document.activeElement).not.toBe(editor())
    act(rerender)
    expect(document.activeElement).not.toBe(editor())
  })
  it('rechecks user intent at commit, not just when the preparation promise resolves', async () => {
    await mount(); act(begin); blur()
    act(() => {
      finish()
      host.querySelector('[data-outside]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(document.activeElement).not.toBe(editor())
  })
  it('ignores a completion after unmount', async () => {
    await mount(); act(begin); blur()
    act(() => root.render(null))
    act(finish)
    expect(document.activeElement).toBe(document.body)
  })
})
