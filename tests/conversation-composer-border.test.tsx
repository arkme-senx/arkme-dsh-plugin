// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { arkmeConversationComposerBorder } from '../src/client/conversation-composer-presentation.js'

describe('composer border transitions', () => {
  it('restores the top edge immediately after sending or cancelling a target, including resize and focus updates', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      for (const [hasTarget, highlighted, focused] of [
        [false, false, false], [true, false, true], [false, false, true],
        [false, false, false], [true, false, false], [true, true, false],
        [true, false, false], [false, false, false], [false, true, false],
        [false, false, true],
      ] as const) {
        act(() => root.render(<div style={{
          background: focused ? '#fff' : '#f6f6f6',
          ...arkmeConversationComposerBorder('#dfe1e6', hasTarget, highlighted),
        }} />))
        const style = getComputedStyle(host.firstElementChild!)
        expect(style.borderTopWidth).toBe(hasTarget && !highlighted ? '0px' : '1px')
        expect(style.borderTopStyle).toBe('solid')
        expect(style.borderRightWidth).toBe('1px')
        expect(style.borderBottomWidth).toBe('1px')
        expect(style.borderLeftWidth).toBe('1px')
        expect(style.borderTopColor).toBe(highlighted ? 'rgb(9, 184, 62)' : 'rgb(223, 225, 230)')
        expect(style.borderRadius).toBe(highlighted ? '12px' : hasTarget ? '0 0 15px 15px' : '15px')
      }
    } finally {
      act(() => root.unmount())
      host.remove()
      vi.unstubAllGlobals()
    }
  })
})
