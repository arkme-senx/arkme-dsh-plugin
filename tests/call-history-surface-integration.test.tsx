import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('call history surface integration', () => {
  it('mounts the call history prototype instead of the message composer', () => {
    arkmeUi.showCalls()
    const markup = renderToStaticMarkup(<ArkmeSurface initialAuth={{
      status: 'authenticated', environment: 'test', userId: 10001,
    }} />)

    expect(markup).toContain('data-arkme-call-history="prototype"')
    expect(markup).toContain('aria-label="视频通话回放"')
    expect(markup).toContain('aria-label="聊天式通话转写"')
    expect(markup).not.toContain('aria-label="发送消息"')
  })
})
