import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

describe('conversation composer redesign styles', () => {
  it.each([
    { dark: false, idle: '#f6f6f6', focused: '#ffffff' },
    { dark: true, idle: '#151515', focused: '#000000' },
  ])('applies primary composer colors without a route wrapper (dark=$dark)', async ({ dark, idle, focused }) => {
    const css = await readFile(new URL('../src/client/redesign/arkme-redesign.css', import.meta.url), 'utf8')
    // Exercise the actual primary-composer rules, including their ancestor selectors.
    const rules = css.match(/[^{}]*\[data-arkme-primary-composer="true"\][^{}]*\{[^{}]*\}/g) ?? []
    expect(rules).toHaveLength(4)
    const dom = new JSDOM(`<body${dark ? ' data-ds-dark-theme' : ''}>
      <main data-arkme-owned="persistent-workspace">
        <div data-arkme-owned="arkme-conversation-layer">
          <div class="arkme-conversation-surface">
            <div class="arkme-conversation-composer-inner" data-arkme-primary-composer="true" data-arkme-composer-focused="false"></div>
            <div class="arkme-conversation-composer-inner" data-other-composer></div>
          </div>
        </div>
      </main>
    </body>`)
    try {
      const { document } = dom.window
      const style = document.createElement('style')
      style.textContent = rules.join('\n')
      document.head.append(style)
      const composer = document.querySelector('[data-arkme-primary-composer]')!
      for (const hasFocus of [false, true, false]) {
        composer.setAttribute('data-arkme-composer-focused', String(hasFocus))
        const computed = dom.window.getComputedStyle(composer)
        expect(computed.getPropertyValue('--arkme-primary-composer-idle').trim()).toBe(idle)
        expect(computed.getPropertyValue('--arkme-primary-composer-focused').trim()).toBe(focused)
        // JSDOM does not resolve var() in background shorthands. Verify the
        // matching source declaration separately from computed custom properties.
        const matching = Array.from(style.sheet!.cssRules)
          .filter((rule): rule is CSSStyleRule => 'selectorText' in rule && composer.matches((rule as CSSStyleRule).selectorText))
        expect(matching.at(-1)!.style.getPropertyValue('background')).toBe(hasFocus
          ? 'var(--arkme-primary-composer-focused, #ffffff)'
          : 'var(--arkme-primary-composer-idle, #f6f6f6)')
        expect(computed.boxShadow).toBe('none')
      }
      const other = dom.window.getComputedStyle(document.querySelector('[data-other-composer]')!)
      expect(other.getPropertyValue('--arkme-primary-composer-idle')).toBe('')
      expect(other.getPropertyValue('--arkme-primary-composer-focused')).toBe('')
      expect(other.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    } finally {
      dom.window.close()
    }
  })
})
