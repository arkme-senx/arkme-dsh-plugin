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

    expect(markup).toContain('>时间与内容<')
    expect(markup).toContain('>当天时间轴<')
    expect(markup).toContain('aria-label="录音列表"')
    expect(markup).not.toContain('data-arkme-owned="directory-pane"')
    expect(markup).not.toContain('aria-label="发送消息"')
  })
})
