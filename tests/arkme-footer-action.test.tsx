import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeFooterAction, type ArkmeFooterActionProps } from '../src/client/ArkmeFooterAction.js'

function renderFooter(patch: Partial<ArkmeFooterActionProps> = {}): string {
  const props = {
    wide: true,
    toggle: () => undefined,
    activate: () => undefined,
    useSessions: ((selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })),
    ...patch,
  } as ArkmeFooterActionProps
  return renderToStaticMarkup(<ArkmeFooterAction {...props} />)
}

describe('ArkmeFooterAction', () => {
  it('shows the total Chat unread count on the right', () => {
    const html = renderFooter({ authenticated: true, unreadCount: 12 })

    expect(html).toContain('Arkme · 12 条未读')
    expect(html).toContain('>12</span>')
  })

  it('caps large unread counts and keeps logged-out state authoritative', () => {
    expect(renderFooter({ authenticated: true, unreadCount: 120 })).toContain('>99+</span>')
    expect(renderFooter({ loggedOut: true, unreadCount: 12 })).not.toContain('>12</span>')
  })
})
