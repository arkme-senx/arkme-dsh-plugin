import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const redesignCss = readFileSync(
  new URL('../src/client/redesign/arkme-redesign.css', import.meta.url),
  'utf8',
)
const redesignStylesSource = readFileSync(
  new URL('../src/client/redesign/styles.ts', import.meta.url),
  'utf8',
)

describe('Arkme redesign dark theme', () => {
  it('keeps the existing light rules and scopes dark colors to the DSH theme attribute', () => {
    expect(redesignCss).toContain('.arkme-redesign-root {')
    expect(redesignCss).toContain('background: #fff;')
    expect(redesignCss).toContain('body[data-ds-dark-theme] [data-arkme-workspace] {')

    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))
    expect(darkCss).toContain('--arkme-line: var(--dsw-alias-border-l1);')
    expect(darkCss).toContain('color: var(--dsw-alias-label-primary);')
  })

  it('maps every redesign surface family to DSH semantic backgrounds', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))
    for (const selector of [
      '.arkme-redesign-root',
      '.arkme-redesign-chat-panel',
      '.arkme-redesign-content',
      '.arkme-redesign-feature-page',
      '.arkme-redesign-settings-surface',
      '.arkme-redesign-model-settings',
      '.arkme-redesign-details',
      '.arkme-workspace-dialog',
    ]) expect(darkCss).toContain(selector)

    expect(darkCss).toContain('background: var(--dsw-alias-bg-base)')
    expect(darkCss).toContain('background: var(--dsw-specific-sidebar-fill)')
    expect(darkCss).toContain('background: var(--dsw-specific-menu)')
    expect(darkCss).toContain('background: var(--dsw-specific-input-major)')
  })

  it('uses DSH hover, active, border, text, and state tokens for dark interactions', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))
    for (const token of [
      '--dsw-alias-interactive-bg-hover',
      '--dsw-alias-interactive-bg-active',
      '--dsw-alias-border-l1',
      '--dsw-alias-border-l2',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--dsw-alias-state-business-primary',
      '--dsw-alias-state-error-primary',
    ]) expect(darkCss).toContain(token)
  })

  it('overrides the inline light colors used by the persistent DSH shell', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="persistent-sidebar"]')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="persistent-workspace"]')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="product-navigation"]')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="product-brand"]')
    expect(darkCss).toContain('[data-arkme-theme-image="light"] { display: none !important; }')
    expect(darkCss).toContain('[data-arkme-theme-image="dark"] { display: block !important; }')
    expect(darkCss).toContain('background: transparent !important;')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="product-navigation"] button[aria-current="page"]')
    expect(darkCss).toContain('background: var(--dsw-specific-sidebar-fill) !important;')
    expect(darkCss).toContain('background: var(--dsw-alias-interactive-bg-active) !important;')
  })

  it('covers the conversation surface hosted directly by the persistent workspace', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="persistent-workspace"] .arkme-conversation-surface')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="persistent-workspace"] .arkme-conversation-composer')
  })

  it('covers inline search and World surfaces rendered outside redesign wrappers', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="persistent-workspace"] div:has(> input[aria-label="搜索"])')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="world-surface"]')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="world-surface"] article')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="world-surface"] button[aria-label="刷新"]')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="world-surface"] [role="status"]')
  })

  it('covers the product conversation directory and its inline light controls', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="directory-pane"]')
    expect(darkCss).toContain('[data-arkme-owned="persistent-sidebar"] [aria-label="Arkme 会话列表"]')
    expect(darkCss).toContain('[aria-label="Arkme 会话列表"]')
    expect(darkCss).toContain('input[aria-label="搜索对话或消息"]')
    expect(darkCss).toContain('button[aria-label="新任务"]')
    expect(darkCss).toContain('[role="treeitem"][aria-selected="true"]')
  })

  it('covers the recording capture buttons without changing their geometry', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('[data-arkme-owned="product-surface"] [aria-label="全天候录音操作"]')
    expect(darkCss).toContain('[aria-label="全天候录音操作"] > div > button')
    expect(darkCss).toContain('[aria-label="全天候录音操作"] > div > button:first-child')
    expect(darkCss).toContain('background: var(--dsw-alias-button-primary-fill) !important;')
    expect(darkCss).toContain('color: var(--dsw-alias-label-primary-inverted) !important;')
  })

  it('covers the calendar portal, day selection, and record panel', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('[aria-label="客户端日历"]:has(> button[aria-label="关闭日历"])')
    expect(darkCss).toContain('section[aria-label="当天内容"]')
    expect(darkCss).toContain('button[data-selected="false"][aria-label*="条记录"]')
    expect(darkCss).toMatch(/button\[data-selected="true"\] > span:last-child \{[^}]*background: transparent !important;[^}]*color: var\(--dsw-alias-label-primary-inverted\) !important;/)
    expect(darkCss).not.toContain('button[style*="--dsw-alias-button-primary-fill"]')
    expect(darkCss).toContain('background: var(--dsw-alias-bg-layer-1) !important;')
  })

  it('keeps the task start brand and control hierarchy readable in dark mode', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toMatch(/\.arkme-redesign-task-greeting img \{[^}]*filter: invert\(1\) hue-rotate\(180deg\)/)
    expect(darkCss).toMatch(/\.arkme-redesign-hero-input \{[^}]*background: var\(--dsw-specific-input-major\) !important/)
    expect(darkCss).toMatch(/\.arkme-redesign-hero-input textarea \{[^}]*background: transparent !important/)
    for (const selector of [
      '.arkme-redesign-source-button',
      '.arkme-redesign-round-tool',
      '.arkme-redesign-starter-icon',
    ]) expect(darkCss).toContain(selector)
    expect(darkCss).toMatch(/\.arkme-redesign-starter-icon[^}]*background: var\(--dsw-alias-button-elevated-fill\) !important/)
    expect(darkCss).toMatch(/\.arkme-redesign-send-task:disabled \{[^}]*background: var\(--dsw-alias-button-elevated-fill\) !important;[^}]*color: var\(--dsw-alias-label-secondary\) !important;/)
  })

  it('covers the complete World body, dialogs, comments, and readable copy', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('[data-arkme-owned="world-surface"] > div:not([role])')
    expect(darkCss).toContain('[data-arkme-owned="world-surface"] [role="dialog"]:not([aria-label="世界图片预览"]) > section')
    expect(darkCss).toContain('[data-arkme-owned="world-surface"] section[aria-label$="的评论区"]')
    expect(darkCss).toContain('[data-arkme-owned="world-surface"] article p')
  })

  it('refreshes a retained style element when a newer plugin bundle is installed', () => {
    expect(redesignStylesSource).toContain('existing.textContent = redesignCss')
  })
})
