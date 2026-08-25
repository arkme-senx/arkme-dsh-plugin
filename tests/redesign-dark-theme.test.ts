import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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
  it('keeps Contact World media on the existing fixed three-column thumbnail grid', () => {
    const imageGridRule = redesignCss.match(/\.arkme-contact-world-images\s*\{([^{}]+)\}/)?.[1] ?? ''
    const imageRule = redesignCss.match(/\.arkme-contact-world-image\s*\{([^{}]+)\}/)?.[1] ?? ''
    const imagePlaceholderRule = redesignCss.match(/\.arkme-contact-world-image-error,\s*\.arkme-contact-world-image-loading\s*\{([^{}]+)\}/)?.[1] ?? ''

    expect(imageGridRule).toContain('width: 100%')
    expect(imageGridRule).toContain('max-width: 620px')
    expect(imageGridRule).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(imageGridRule).not.toContain('auto-fit')
    expect(imageRule).toContain('aspect-ratio: 1')
    expect(imageRule).not.toContain('max-height: 240px')
    expect(imagePlaceholderRule).toContain('aspect-ratio: 1')
  })

  it('keeps the contact profile fixed while only the lower World pane scrolls', () => {
    const detailPaneRule = redesignCss.match(/\.arkme-directory-detail-pane\s*\{([^{}]+)\}/)?.[1] ?? ''
    const contactDetailRule = redesignCss.match(/\.arkme-contact-detail\s*\{([^{}]+)\}/)?.[1] ?? ''
    const directoryRule = redesignCss.match(/\.arkme-contact-directory\s*\{([^{}]+)\}/)?.[1] ?? ''
    const worldContainerRule = redesignCss.match(/\.arkme-contact-world-container\s*\{([^{}]+)\}/)?.[1] ?? ''

    expect(detailPaneRule).toContain('overflow: hidden')
    expect(contactDetailRule).toContain('height: 100%')
    expect(contactDetailRule).toContain('overflow: hidden')
    expect(directoryRule).toContain('overflow-y: auto')
    expect(worldContainerRule).toContain('overflow-y: auto')
  })

  it('gives every production Contacts class a substantive scoped rule', () => {
    const contactsDir = new URL('../src/client/redesign/contacts/', import.meta.url).pathname
    const contactsClasses = new Set<string>()
    for (const file of readdirSync(contactsDir).filter(name => name.endsWith('.tsx'))) {
      const source = readFileSync(join(contactsDir, file), 'utf8')
      for (const match of source.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
        for (const token of (match[1] ?? match[2] ?? '').split('${')[0].split(/\s+/)) {
          if (/^arkme-(?:contact|directory|unmarked)-/.test(token)) contactsClasses.add(token)
        }
      }
    }
    expect(contactsClasses.size).toBe(83)
    for (const className of contactsClasses) {
      const rule = redesignCss.match(new RegExp(`\\.${className}(?:[\\s,:.#\\[>+~-][^{}]*)?\\{([^{}]+)\\}`))
      expect(rule, `${className} must have a CSS rule with declarations`).not.toBeNull()
      expect(rule?.[1].trim(), `${className} must not use an empty rule`).not.toBe('')
    }
    expect(redesignCss).toContain('.arkme-contact-directory-row:not(.is-static):hover')
    expect(redesignCss).not.toContain('.arkme-contact-directory-row.is-static:hover')
    expect(redesignCss).toContain('.arkme-contact-directory-section-header[aria-expanded="true"] .arkme-contact-directory-caret { transform: rotate(90deg); }')
  })
  it('reassigns the real AppFrame grid tracks for Contacts narrow directory and detail seats', () => {
    expect(redesignCss).toContain('div:has(> [data-shell-overlay]):has([data-arkme-directory-mode="contacts"]):has([data-arkme-contacts-mobile-view="directory"])')
    expect(redesignCss).toContain('grid-template-columns: minmax(0, 1fr) 0px 0px !important')
    expect(redesignCss).toContain('div:has(> [data-shell-overlay]):has([data-arkme-directory-mode="contacts"]):has([data-arkme-contacts-mobile-view="content"])')
    expect(redesignCss).toContain('grid-template-columns: 0px minmax(0, 1fr) 0px !important')
    expect(redesignCss).not.toContain('.pI_x6G_frame')
    expect(redesignCss).not.toContain('data-details-collapsed]):has([data-arkme-owned="persistent')
  })
  it('keeps the existing light rules and scopes dark colors to the DSH theme attribute', () => {
    expect(redesignCss).toContain('.arkme-redesign-root {')
    expect(redesignCss).toContain('background: #fff;')
    expect(redesignCss).toContain('body[data-ds-dark-theme] [data-arkme-workspace] {')

    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))
    expect(darkCss).toContain('--arkme-line: var(--dsw-alias-border-l1);')
    expect(darkCss).toContain('color: var(--dsw-alias-label-primary);')
    expect(darkCss).toContain('.arkme-unmarked-speaker-gone')
    expect(darkCss).toContain('.arkme-unmarked-speaker-success')
    expect(darkCss).toContain('var(--dsw-alias-state-success-tertiary)')
    expect(darkCss).toContain('var(--dsw-alias-state-error-primary)')
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
    expect(redesignCss).toContain('[data-arkme-workspace] [data-arkme-theme-image="dark"] { display: none !important; }')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-workspace] [data-arkme-theme-image="light"] { display: none !important; }')
    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-workspace] [data-arkme-theme-image="dark"] { display: block !important; }')
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

  it('covers inline search rendered outside redesign wrappers', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).toContain('body[data-ds-dark-theme] [data-arkme-owned="persistent-workspace"] div:has(> input[aria-label="搜索"])')
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

  it('styles the confirmed directory, Logo, contact World, and speaker layouts with bounded wrapping', () => {
    for (const selector of [
      '.arkme-contact-directory',
      '.arkme-contact-directory-section-header',
      '.arkme-contact-directory-letter',
      '.arkme-contact-directory-row.is-selected',
      '.arkme-directory-detail-empty',
      '.arkme-directory-detail-logo',
      '.arkme-contact-detail',
      '.arkme-contact-profile',
      '.arkme-contact-world-card',
      '.arkme-unmarked-speaker-summary',
      '.arkme-unmarked-speaker-audio',
      '.arkme-unmarked-speaker-choice',
    ]) expect(redesignCss).toContain(selector)

    expect(redesignCss).toMatch(/\.arkme-contact-directory, \.arkme-directory-detail-pane \{[^}]*min-width: 0;[^}]*min-height: 0;[^}]*height: 100%;[^}]*overflow: hidden;/)
    expect(redesignCss).toContain('overflow-wrap: anywhere;')
    expect(redesignCss).toContain('.arkme-contact-directory-row:not(.is-static):hover')
    expect(redesignCss).not.toContain('.arkme-contact-directory-row.is-static:hover')
    expect(redesignCss).toMatch(/\[data-arkme-workspace\] \.arkme-contact-profile-message \{[^}]*background: var\(--dsw-alias-button-primary-fill/)
  })

  it('styles the mobile-derived speaker identity, inference, action, audio, and choice hierarchy', () => {
    for (const selector of [
      '.arkme-unmarked-speaker-token-avatar',
      '.arkme-unmarked-speaker-identity',
      '.arkme-unmarked-speaker-stats',
      '.arkme-unmarked-speaker-inference',
      '.arkme-unmarked-speaker-action',
      '.arkme-unmarked-speaker-subview-header',
      '.arkme-unmarked-speaker-segment-card',
      '.arkme-unmarked-speaker-choice-option',
      '.arkme-unmarked-speaker-confirm',
    ]) expect(redesignCss).toContain(selector)

    expect(redesignCss).toMatch(/\.arkme-unmarked-speaker-summary \{[^}]*border: 0;[^}]*background: transparent;/)
    expect(redesignCss).toMatch(/\.arkme-unmarked-speaker-action \{[^}]*grid-template-columns: 42px minmax\(0, 1fr\);/)
    expect(redesignCss).toMatch(/@media \(max-width: 820px\) \{[\s\S]*\.arkme-unmarked-speaker-stats/)
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))
    expect(darkCss).toContain('body[data-ds-dark-theme] .arkme-unmarked-speaker-inference')
    expect(darkCss).toContain('body[data-ds-dark-theme] .arkme-unmarked-speaker-segment-card')
  })

  it('keeps directory actions visibly focused, motion-safe, dark themed, and narrow-window safe', () => {
    expect(redesignCss).toContain('[data-arkme-directory-mode="contacts"]')
    expect(redesignCss).toContain('.arkme-contact-directory button:focus-visible')
    expect(redesignCss).toContain('.arkme-directory-detail-pane button:focus-visible')
    expect(redesignCss).toMatch(/@media \(max-width: 1024px\) \{[\s\S]*data-arkme-directory-mode="contacts"/)
    expect(redesignCss).toMatch(/@media \(max-width: 820px\) \{[^}]*\.arkme-redesign-chat-panel \{ display: none;/)
    expect(redesignCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.arkme-contact-directory-caret/)

    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))
    expect(darkCss).toContain('body[data-ds-dark-theme] .arkme-contact-directory')
    expect(darkCss).toContain('body[data-ds-dark-theme] .arkme-contact-directory-row.is-selected')
    expect(darkCss).toContain('body[data-ds-dark-theme] .arkme-contact-world-card')
    expect(darkCss).toContain('body[data-ds-dark-theme] .arkme-unmarked-speaker-choice')
  })

  it('keeps both Contacts seats bounded at narrow widths', () => {
    expect(redesignCss).toMatch(/@media \(max-width: 820px\) \{[\s\S]*data-arkme-directory-mode="contacts"/)
    expect(redesignCss).toContain('.arkme-directory-detail-pane')
  })

  it('leaves World theming to the component semantic tokens instead of DOM overrides', () => {
    const darkCss = redesignCss.slice(redesignCss.indexOf('body[data-ds-dark-theme] [data-arkme-workspace] {'))

    expect(darkCss).not.toContain('[data-arkme-owned="world-surface"]')
  })

  it('refreshes a retained style element when a newer plugin bundle is installed', () => {
    expect(redesignStylesSource).toContain('existing.textContent = redesignCss')
  })
})
