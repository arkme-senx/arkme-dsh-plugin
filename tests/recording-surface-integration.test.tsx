import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('recording surface integration', () => {
  it('mounts the desktop-parity recording workbench instead of the message composer', () => {
    arkmeUi.showRecordings()
    const markup = renderToStaticMarkup(<ArkmeSurface initialAuth={{
      status: 'authenticated',
      environment: 'test',
      userId: 10001,
    }} />)

    expect(markup).toContain('aria-label="全天候录音"')
    expect(markup).toContain('aria-label="录音日历"')
    expect(markup).toContain('aria-label="真实录音时间轴"')
    expect(markup).toContain('>导入历史音频<')
    expect(markup).not.toContain('data-arkme-owned="directory-pane"')
    expect(markup).not.toContain('aria-label="发送消息"')
  })
})
