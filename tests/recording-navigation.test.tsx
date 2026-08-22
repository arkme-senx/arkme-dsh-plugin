import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import * as navigation from '../src/client/ArkmeVirtualWorkspace.js'

describe('recording navigation entry', () => {
  it('exposes one owner-rendered directory row primitive for consumer slots', () => {
    const ArkmeDirectoryRow = (navigation as unknown as Record<string, unknown>).ArkmeDirectoryRow
    expect(ArkmeDirectoryRow).toBeDefined()
    if (ArkmeDirectoryRow === undefined) return

    const Row = ArkmeDirectoryRow as ComponentType<{
      avatar: string
      title: string
      preview: string
      selected: boolean
      onClick(): void
    }>
    const markup = renderToStaticMarkup(<Row
      avatar="世"
      title="世界"
      preview="世界公开动态"
      selected
      onClick={vi.fn()}
    />)

    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('>世界<')
    expect(markup).toContain('>世界公开动态<')
    expect(markup).toContain('background:#f1f2f6')
  })

  it('renders a fixed all-day recording row with its read-only feature preview', () => {
    const ArkmeRecordingsRow = navigation.ArkmeRecordingsRow
    expect(ArkmeRecordingsRow).toBeDefined()
    if (ArkmeRecordingsRow === undefined) return

    const markup = renderToStaticMarkup(<ArkmeRecordingsRow selected onClick={vi.fn()} />)
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('全天候录音')
    expect(markup).toContain('转写、日总结与时间轴')
    expect(markup).toContain('<img')
    expect(markup).not.toContain('arkme-audio-analysis-gradient')
  })

  it('renders a search row that advertises AI video together with existing search scopes', () => {
    const markup = renderToStaticMarkup(<navigation.ArkmeSearchRow selected={false} onClick={vi.fn()} />)

    expect(markup).toContain('>搜索<')
    expect(markup).toContain('快记、主题、录音与 AI 视频')
    expect(markup).toContain('/arkme-self/api/call/image_search.svg')
    expect(markup).not.toContain('⌕')
  })

  it('renders the contact-add row as a native directory entry', () => {
    const markup = renderToStaticMarkup(<navigation.ArkmeContactAddRow selected onClick={vi.fn()} />)
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('添加联系人')
    expect(markup).toContain('通过手机号或即我号搜索')
    expect(markup).toContain('mask-image:url(')
    expect(markup).not.toContain('<circle')
  })

  it('uses the exact contact-add icon migrated from the mobile client', () => {
    const icon = readFileSync(new URL('../assets/icons/user-add-linear.svg', import.meta.url))
    expect(createHash('sha256').update(icon).digest('hex'))
      .toBe('3ce1f950f6a3999ecb66f5bf72f1c7e1300f07f2cd5ce426078184cff89f83ff')
  })

})

describe('Arko navigation entry', () => {
  it('renders the client Agent avatar, customizable name, and client-style AI badge', () => {
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
    expect(markup).toContain('data-arkme-topic-tag="AI"')
    expect(markup).toContain('>AI</span>')
    expect(markup).not.toContain('>Agent</span>')
    expect(markup).toContain('刚刚完成了资料整理')
  })

  it('keeps the product description only when no conversation exists yet', () => {
    const markup = renderToStaticMarkup(<navigation.ArkmeArkoRow selected={false} onClick={vi.fn()} />)
    expect(markup).toContain('对话并处理 Arkme 业务')
  })
})

describe('DeepSeek Harness navigation entry', () => {
  it('uses the ordinary conversation-row contract and exposes selected state', () => {
    const DeepSeekHarnessRow = navigation.DeepSeekHarnessRow
    expect(DeepSeekHarnessRow).toBeDefined()
    if (DeepSeekHarnessRow === undefined) return

    const markup = renderToStaticMarkup(<DeepSeekHarnessRow selected onClick={vi.fn()} />)
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('DeepSeek Harness')
    expect(markup).toContain('原生 DeepSeek 开发环境')
    expect(markup).toContain('src="/favicon.svg"')
  })
})
