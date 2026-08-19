import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as navigation from '../src/client/ArkmeVirtualWorkspace.js'

describe('recording navigation entry', () => {
  it('renders a fixed all-day recording row with its read-only feature preview', () => {
    const ArkmeRecordingsRow = navigation.ArkmeRecordingsRow
    expect(ArkmeRecordingsRow).toBeDefined()
    if (ArkmeRecordingsRow === undefined) return

    const markup = renderToStaticMarkup(<ArkmeRecordingsRow selected onClick={vi.fn()} />)
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('全天候录音')
    expect(markup).toContain('转写、日总结与时间轴')
  })

  it('renders a search row that advertises AI video together with existing search scopes', () => {
    const markup = renderToStaticMarkup(<navigation.ArkmeSearchRow selected={false} onClick={vi.fn()} />)

    expect(markup).toContain('>搜索<')
    expect(markup).toContain('快记、主题、录音与 AI 视频')
    expect(markup).toContain('/arkme-self/api/call/image_search.svg')
    expect(markup).not.toContain('⌕')
  })
})

describe('Arko navigation entry', () => {
  it('renders the client Agent avatar, customizable name, and client-style Agent badge', () => {
    const ArkmeArkoRow = navigation.ArkmeArkoRow
    expect(ArkmeArkoRow).toBeDefined()
    if (ArkmeArkoRow === undefined) return

    const markup = renderToStaticMarkup(<ArkmeArkoRow
      selected
      displayName="小可"
      latestPreview="刚刚完成了资料整理"
      onClick={vi.fn()}
    />)
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('小可')
    expect(markup).toContain('viewBox="2 1.4 12 12"')
    expect(markup).toContain('fill="#EFA7A2"')
    expect(markup).toContain('data-arkme-topic-tag="Agent"')
    expect(markup).toContain('>Agent</span>')
    expect(markup).not.toContain('>AI</span>')
    expect(markup).toContain('刚刚完成了资料整理')
  })

  it('keeps the product description only when no conversation exists yet', () => {
    const markup = renderToStaticMarkup(<navigation.ArkmeArkoRow selected={false} onClick={vi.fn()} />)
    expect(markup).toContain('对话并处理 Arkme 业务')
  })
})
