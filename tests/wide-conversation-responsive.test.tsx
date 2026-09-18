// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeWideConversation, WIDE_CONVERSATION_WIDTH_KEY } from '../src/client/ArkmeWideConversation.js'
import { loadHarnessConversationLayout } from '../src/client/harness-conversation-layout.js'

vi.mock('../src/client/harness-conversation-layout.js', () => ({ loadHarnessConversationLayout: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('wide conversation responsive lifecycle', () => {
  it('links width and saves preference without remounting the draft across breakpoints', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let column = 1200
    const observers = new Set<() => void>()
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) { observers.add(callback) }
      observe() {}
      disconnect() { observers.delete(this.callback) }
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => column)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600)
    const resolve = (width: number, pref: number | null) => Math.min(width - 176, Math.max(640, pref ?? width * .64))
    vi.mocked(loadHarnessConversationLayout).mockResolvedValue({ rootClass: 'native-root', resolveContentWidth: resolve,
      WidthHandle: props => <button data-width-handle={props.side} onClick={() => {
        const width = props.onStart() - 100
        props.onDrag(width); props.onCommit(width); props.onEnd()
      }} />,
      TurnNavigator: () => null,
    })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const ref = createRef<HTMLDivElement>()
    try {
      await act(async () => root.render(<ArkmeWideConversation enabled scopeKey="private:1" viewportRef={ref}>
        <div ref={ref} data-arkme-width-viewport><div data-arkme-width-anchor="a">message</div></div>
        <footer data-arkme-width-composer><textarea defaultValue="unfinished draft" /></footer>
      </ArkmeWideConversation>))
      const editor = host.querySelector('textarea')!
      const shell = host.querySelector('[data-arkme-wide-conversation]') as HTMLElement
      expect(shell.dataset.arkmeWideConversation).toBe('true')
      expect(host.querySelectorAll('[data-width-handle]')).toHaveLength(2)
      await act(async () => (host.querySelector('[data-width-handle]') as HTMLElement).click())
      expect(localStorage.getItem(WIDE_CONVERSATION_WIDTH_KEY)).toBe('668')
      expect(shell.style.getPropertyValue('--dsh-chat-user-width')).toBe('668px')
      column = 900
      await act(async () => { for (const callback of [...observers]) callback() })
      expect(shell.dataset.arkmeWideConversation).toBe('false')
      expect(host.querySelectorAll('[data-width-handle]')).toHaveLength(0)
      column = 1200
      await act(async () => { for (const callback of [...observers]) callback() })
      expect(shell.dataset.arkmeWideConversation).toBe('true')
      expect(shell.style.getPropertyValue('--dsh-chat-user-width')).toBe('668px')
      expect(host.querySelector('textarea')).toBe(editor)
      expect(editor.value).toBe('unfinished draft')
      expect(loadHarnessConversationLayout).toHaveBeenCalledTimes(1)
    } finally { await act(async () => root.unmount()); host.remove() }
    expect(observers.size).toBe(0)
  })
})
