import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it , vi } from 'vitest'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('call history surface integration', () => {
  it('mounts the call surface instead of the message composer', () => {
    arkmeUi.showCalls()
    const markup = renderToStaticMarkup(<ArkmeSurface initialAuth={{
      status: 'authenticated', environment: 'test', userId: 10001,
    }} />)

    expect(markup).toContain('aria-label="通话"')
    expect(markup).toContain('搜索通话记录')
    expect(markup).toContain('从一次问候开始')
    expect(markup).toContain('最近通话')
    expect(markup).toContain('正在读取通话记录')
    expect(markup).not.toContain('data-arkme-call-history="prototype"')
    expect(markup).not.toContain('aria-label="发送消息"')
  })
})

// This suite renders the existing qualified-account layout.
vi.mock('../src/client/social-access-store.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/social-access-store.js')>(), useSocialAccess: () => true,
  useSocialAccessPresentation: () => ({ visible: true, ready: true }),
}))
