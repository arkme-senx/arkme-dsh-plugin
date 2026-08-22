import { describe, expect, it, vi } from 'vitest'
import { restoreArkmeComposerFocus, type ArkmeComposerFocusTarget } from '../src/client/composer-focus.js'

function focusTarget(disabled = false, value = '继续输入') {
  return {
    target: {
      disabled,
      value,
      focus: vi.fn(),
      setSelectionRange: vi.fn(),
    } satisfies ArkmeComposerFocusTarget,
  }
}

describe('restoreArkmeComposerFocus', () => {
  it('输入框解除禁用后恢复焦点并把光标放到末尾', () => {
    const { target } = focusTarget()
    const body = {} as HTMLElement

    expect(restoreArkmeComposerFocus(target, body, body, false)).toBe(true)
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(target.setSelectionRange).toHaveBeenCalledWith(4, 4)
  })

  it('输入框仍禁用时不恢复焦点', () => {
    const { target } = focusTarget(true)

    expect(restoreArkmeComposerFocus(target, null, null, true)).toBe(false)
    expect(target.focus).not.toHaveBeenCalled()
  })

  it('用户已经聚焦到对话输入区之外时不抢焦点', () => {
    const { target } = focusTarget()
    const activeElement = {} as Element
    const body = {} as HTMLElement

    expect(restoreArkmeComposerFocus(target, activeElement, body, false)).toBe(false)
    expect(target.focus).not.toHaveBeenCalled()
  })

  it('发送按钮或附件控件仍位于输入区时允许恢复焦点', () => {
    const { target } = focusTarget()
    const activeElement = {} as Element

    expect(restoreArkmeComposerFocus(target, activeElement, {} as HTMLElement, true)).toBe(true)
    expect(target.focus).toHaveBeenCalledOnce()
  })
})
