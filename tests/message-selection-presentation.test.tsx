// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArkmeMessageSelectionControl, messageSelectionStyles } from '../src/client/message-selection-presentation.js'

it('uses the interactive active background for selected messages', () => {
  expect(messageSelectionStyles.rowSelectedForAction.background).toContain('interactive-bg-active')
})

it('restores the unselected border after repeated checked transitions without conflicting styles', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    for (const checked of [false, true, false, true, false]) {
      await act(async () => root.render(<ArkmeMessageSelectionControl anchor="card-center" checked={checked} disabled={false} onToggle={() => {}} />))
      const circle = host.querySelector('span')!
      expect(circle.style.borderColor).toContain(checked ? 'business-primary' : 'label-tertiary')
      expect(circle.style.borderStyle).toBe('solid')
      expect(circle.style.borderWidth).toBe('1.5px')
    }
    expect(errors).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    errors.mockRestore()
    vi.unstubAllGlobals()
  }
})
