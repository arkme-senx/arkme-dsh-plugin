import { describe, expect, it, vi } from 'vitest'
import {
  isOfficialNewSessionTarget, watchOfficialNewSession,
} from '../src/client/new-session-activation.js'

function targetWithLabel(label: string) {
  return {
    closest: (selector: string) => selector === 'button'
      ? { getAttribute: (name: string) => name === 'aria-label' ? label : null }
      : null,
  } as never
}

describe('official New Session compatibility listener', () => {
  it('recognizes the official Chinese and English accessible labels only', () => {
    expect(isOfficialNewSessionTarget(targetWithLabel('新建会话'))).toBe(true)
    expect(isOfficialNewSessionTarget(targetWithLabel('New session'))).toBe(true)
    expect(isOfficialNewSessionTarget(targetWithLabel('即我'))).toBe(false)
  })

  it('captures activation while installed and removes the listener on dispose', () => {
    let listener: ((event: MouseEvent) => void) | undefined
    const ownerDocument = {
      addEventListener: vi.fn((_type, next) => { listener = next as (event: MouseEvent) => void }),
      removeEventListener: vi.fn(),
    } as unknown as Document
    const onActivate = vi.fn()

    const stop = watchOfficialNewSession(onActivate, ownerDocument)
    listener?.({ target: targetWithLabel('新建会话') } as never)
    listener?.({ target: targetWithLabel('设置') } as never)

    expect(onActivate).toHaveBeenCalledOnce()
    stop()
    expect(ownerDocument.removeEventListener).toHaveBeenCalledWith('click', listener, true)
  })
})
