import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeSocialBindingHint } from '../src/client/ArkmeSocialBindingHint.js'
import { arkmeUi } from '../src/client/ui-controller.js'

it('opens the existing account settings and closes the originating menu', () => {
  const open = vi.fn()
  const close = vi.fn()
  const stop = arkmeUi.bindSettingsOpener(open)
  const renderer = create(<ArkmeSocialBindingHint onOpen={close} />)
  try {
    const button = renderer.root.findByType('button')
    expect(button.props['aria-label']).toBe('去绑定')
    expect(renderer.root.findByProps({ id: button.props['aria-describedby'] }).children.join('')).toBe('绑定手机号后即可使用社交功能')
    act(() => renderer.root.findByType('button').props.onClick())
    expect(close).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledExactlyOnceWith('arkme-account')
  } finally {
    renderer.unmount()
    stop()
  }
})
