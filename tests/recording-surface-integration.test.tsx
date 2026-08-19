import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('recording surface integration', () => {
  it('mounts the read-only recording page instead of the message composer', () => {
    arkmeUi.showRecordings()
    const markup = renderToStaticMarkup(<ArkmeSurface initialAuth={{
      status: 'authenticated',
      environment: 'test',
      userId: 10001,
    }} />)

    expect(markup).toContain('>全天候录音<')
    expect(markup).toContain('aria-label="录音日历"')
    expect(markup).toContain('aria-label="录音详情"')
    expect(markup).not.toContain('aria-label="发送消息"')
  })
})
