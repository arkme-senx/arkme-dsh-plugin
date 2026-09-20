// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArkmeRichComposerInput, type ArkmeRichComposerHandle } from '../src/client/ArkmeRichComposerInput.js'

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
