// @vitest-environment jsdom
import { act, createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'
import type { ArkmeComposerSelectionRequest } from '../src/client/composer-selection-request.js'

it('renders escaped mention source in the real editor and preserves raw UTF-16 selection through updates', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const ref = createRef<ArkmeRichComposerHandle>()
  const changed = vi.fn()
  const text = String.raw`😀 @A\_B 后文`
  const render = (textFormat: 'plain' | 'markdown') => act(() => root.render(<ArkmeRichComposerInput
    ref={ref} value={text} textFormat={textFormat}
    mentions={[{ originalIndex: 0, displayName: 'A_B', startIndex: 3, length: 5 }]}
    emojis={[]} maxLength={20000} placeholder="重新编辑" ariaLabel="重新编辑" disabled={false}
    style={{}} onTextChange={changed} />))
  try {
    render('markdown')
    const editor = host.querySelector('[data-arkme-rich-composer]') as HTMLDivElement
    expect(editor.textContent).toBe(text)
    expect(editor.querySelector('span')?.textContent).toBe(String.raw`@A\_B`)
    act(() => { ref.current!.focus(); ref.current!.setSelectionRange(8, 8) })
    expect(ref.current!.selectionStart).toBe(8)
    render('markdown')
    expect(ref.current!.selectionStart).toBe(8)
    expect(editor.textContent).toBe(text)
    expect(changed).not.toHaveBeenCalled()
    render('plain')
    expect(editor.querySelector('span')).toBeNull()
    expect(editor.textContent).toBe(text)
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})


it('keeps the native composition and mid-text caret through a parent render', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const ref = createRef<ArkmeRichComposerHandle>()
  const changed = vi.fn()
  function Reedit() {
    const [value, setValue] = useState('前后')
    const [, setActivity] = useState('')
    return <ArkmeRichComposerInput ref={ref} value={value} mentions={[]} emojis={[]} maxLength={20000}
      placeholder="重新编辑" ariaLabel="重新编辑" disabled={false} style={{}}
      onInputActivity={setActivity} onTextChange={text => { changed(text); setValue(text) }} />
  }
  try {
    act(() => root.render(<Reedit />))
    const editor = host.querySelector('[data-arkme-rich-composer]') as HTMLDivElement
    const nativeText = editor.firstChild as Text
    act(() => {
      ref.current!.focus()
      ref.current!.setSelectionRange(1, 1)
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      nativeText.data = '前zhong后'
      document.getSelection()!.collapse(nativeText, 6)
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    })
    expect(editor.firstChild).toBe(nativeText)
    expect(editor.textContent).toBe('前zhong后')
    expect(ref.current!.selectionStart).toBe(6)
    expect(changed).not.toHaveBeenCalled()

    act(() => {
      nativeText.data = '前中后'
      document.getSelection()!.collapse(nativeText, 2)
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }))
    })
    expect(changed).toHaveBeenCalledExactlyOnceWith('前中后')
    expect(editor.textContent).toBe('前中后')
    expect(ref.current!.selectionStart).toBe(2)
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})


it.each(['tail', 'middle', 'other control'] as const)('opens at the tail and preserves the user’s choice after hydration (%s)', position => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const ref = createRef<ArkmeRichComposerHandle>()
  const request: ArkmeComposerSelectionRequest = { atEnd: true }
  const render = (value: string) => act(() => root.render(<>
    <button type="button">其他位置</button>
    <ArkmeRichComposerInput ref={ref} value={value} mentions={[]} emojis={[]} maxLength={20000}
      selectionRequest={request} placeholder="重新编辑" ariaLabel="重新编辑" disabled={false}
      style={{}} onTextChange={() => {}} />
  </>))
  try {
    render('初始正文')
    const editor = host.querySelector('[data-arkme-rich-composer]')
    const button = host.querySelector('button')!
    expect(document.activeElement).toBe(editor)
    expect(ref.current!.selectionStart).toBe(4)
    act(() => {
      if (position === 'middle') ref.current!.setSelectionRange(1, 3)
      if (position === 'other control') button.focus()
    })

    const hydrated = '更长的本机草稿😀'
    render(hydrated)
    expect(editor?.textContent).toBe(hydrated)
    expect(document.activeElement).toBe(position === 'other control' ? button : editor)
    if (position !== 'other control') {
      expect(ref.current!.selectionStart).toBe(position === 'middle' ? 1 : hydrated.length)
      expect(ref.current!.selectionEnd).toBe(position === 'middle' ? 3 : hydrated.length)
    }
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
