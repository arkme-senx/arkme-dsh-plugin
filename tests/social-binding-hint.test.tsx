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
    expect(renderer.root.findByType('p').children.join('')).toContain('聊天、世界、联系人和通话')
    act(() => renderer.root.findByType('button').props.onClick())
    expect(close).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledExactlyOnceWith('arkme-account')
  } finally {
    renderer.unmount()
    stop()
  }
})
