import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
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

  it('keeps the account-scoped import owner mounted after leaving the recording page', async () => {
    const auth = {
      status: 'authenticated' as const,
      environment: 'test' as const,
      userId: 10001,
    }
    arkmeUi.showRecordings()
    const recordingMarkup = renderToStaticMarkup(<ArkmeSurface initialAuth={auth} />)
    arkmeUi.showSearch()
    const searchMarkup = renderToStaticMarkup(<ArkmeSurface initialAuth={auth} />)

    expect(recordingMarkup).toContain('aria-label="上传文件"')
    expect(searchMarkup).toContain('aria-label="上传文件"')
    expect(searchMarkup).not.toContain('>导入历史音频<')

    const suspendedMarkup = renderToStaticMarkup(<ArkmeSurface initialAuth={auth} active={false} />)
    expect(suspendedMarkup).toContain('data-arkme-surface-suspended="true"')
    expect(suspendedMarkup).toContain('aria-label="上传文件"')

    const source = await readFile(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')
    expect(source).toContain("const recordingImportForeground = active && ui.mode === 'recordings'")
    expect(source).toContain('if (!recordingImportForeground) recordingImportDialogRef.current?.close()')
  })
})
