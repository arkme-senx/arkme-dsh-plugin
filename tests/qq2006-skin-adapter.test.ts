import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const redesignCss = readFileSync(
  new URL('../src/client/redesign/arkme-redesign.css', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')

describe('QQ2006 skin adapter', () => {
  const skinSelector = "body:is([data-ds-skin='qq2006'], [data-arkme-skin='qq2006'])"
  const marker = `${skinSelector} [data-arkme-workspace] {`
  const qqCss = redesignCss.slice(redesignCss.indexOf(marker))

  it('is isolated behind the skin attribute', () => {
    expect(redesignCss).toContain(marker)
    expect(qqCss).not.toContain('body[data-ds-dark-theme]')
    expect(qqCss).not.toContain('@media (prefers-color-scheme')
  })

  it('adapts the main Arkme navigation and conversation surfaces', () => {
    expect(qqCss).toContain(`${skinSelector} .arkme-redesign-rail {`)
    expect(qqCss).toContain(`${skinSelector} .arkme-redesign-chat-panel {`)
    expect(qqCss).toContain(`${skinSelector} .arkme-redesign-route-chats .arkme-conversation-header {`)
    expect(qqCss).toContain(`${skinSelector} .arkme-redesign-route-chats .arkme-conversation-composer-inner {`)
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-navigation'] {`)
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-surface'] .arkme-conversation-header {`)
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-surface'] .arkme-conversation-composer-inner {`)
  })

  it('uses the host QQ theme tokens and keeps controls keyboard-visible', () => {
    expect(qqCss).toContain('var(--dsw-alias-bg-base')
    expect(qqCss).toContain('var(--dsw-alias-state-business-primary')
    expect(qqCss).toContain(':focus-visible')
  })

  it('matches the DSH blue shell and inset white conversation directory', () => {
    expect(redesignCss).toContain('.arkme-qq2006-directory-chrome {\n  display: none;')
    expect(qqCss).toContain("background: linear-gradient(180deg, rgb(124, 198, 250) 0%, rgb(96, 184, 252) 40%, rgb(88, 179, 255) 65%, rgb(78, 168, 244) 100%) !important;")
    expect(qqCss).toContain(`${skinSelector} .arkme-qq2006-directory-identity {`)
    expect(qqCss).toContain(`${skinSelector} .arkme-qq2006-directory-tool-bar {`)
    expect(qqCss).toContain(`${skinSelector} [aria-label='Arkme 会话'] {`)
    expect(qqCss).toContain('background: #fff !important;')
    expect(qqCss).toContain("input[aria-label='搜索对话或消息']")
    expect(qqCss).toContain('background: rgb(205, 228, 250) !important;')
  })

  it('uses the DSH bitmap chrome, flat transcript, and both original toolbar rows', () => {
    expect(qqCss).toContain("background-image: var(--arkme-qq-title-left), var(--arkme-qq-title-right), var(--arkme-qq-title-center) !important;")
    expect(qqCss).toContain("background-image: var(--arkme-qq-head-left), var(--arkme-qq-head-right), var(--arkme-qq-head-center) !important;")
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-surface'] .arkme-qq2006-big-toolbar {`)
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-surface'] .arkme-qq2006-small-toolbar {`)
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-surface'] .arkme-qq2006-input-actions {`)
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-surface'] .arkme-qq2006-bottom-row {`)
    expect(qqCss).toContain('background-color: rgb(85, 178, 253) !important;')
    expect(qqCss).toContain('border: 1px solid rgb(53, 111, 175);')
    expect(qqCss).toContain(`${skinSelector} [data-arkme-owned='product-surface'] [data-arkme-message-direction]::before {`)
    expect(qqCss).toContain('content: none !important;')
    expect(qqCss).toContain("font: var(--arkme-qq-message-size)/1.4 'SimSun', 'Songti SC', serif !important;")
  })
})
