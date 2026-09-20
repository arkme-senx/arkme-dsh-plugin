// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'

// Vitest omits CSS by default. Feed the production installer the actual stylesheet.
vi.mock('../src/client/day-timeline.css?inline', async () => ({
  default: (await import('node:fs')).readFileSync(`${process.cwd()}/src/client/day-timeline.css`, 'utf8'),
}))

const selector = 'style[data-plugin-css="@senguoyun/dsh-arkme/redesign"]'
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

describe('day timeline production style loading', () => {
  it('installs calendar, timeline and location rules through the plugin lifecycle', () => {
    const dispose = installArkmeRedesignStyles()
    const css = document.querySelector(selector)?.textContent ?? ''
    expect(css).toContain('.arkme-personal-day-calendar')
    expect(css).toContain('.arkme-day-timeline')
    expect(css).toContain('.arkme-day-location-tag')
    expect(css).toContain('@media (max-width: 650px)')
    dispose()
    expect(document.querySelector(selector)).toBeNull()
  })

  it('applies the overlay layout without a separately loaded CSS asset', () => {
    installArkmeRedesignStyles()
    const calendar = document.createElement('section')
    calendar.className = 'arkme-personal-day-calendar'
    document.body.append(calendar)
    const style = getComputedStyle(calendar)
    expect(style.position).toBe('fixed')
    expect(style.display).toBe('grid')
    expect(style.zIndex).toBe('60')
  })

  it('reuses one stylesheet on repeated installation and restores its content', () => {
    const dispose = installArkmeRedesignStyles()
    document.querySelector(selector)!.textContent = ''
    const disposeAgain = installArkmeRedesignStyles()
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)?.textContent).toContain('.arkme-personal-day-calendar')
    disposeAgain()
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    dispose()
    expect(document.querySelector(selector)).toBeNull()
  })
})
