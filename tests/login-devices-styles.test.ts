// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'

// Vitest omits CSS by default; exercise the production installer with the real rules.
vi.mock('../src/client/login-devices.css?inline', async () => ({
  default: (await import('node:fs')).readFileSync(`${process.cwd()}/src/client/login-devices.css`, 'utf8'),
}))
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

it('styles the body portal through the plugin lifecycle without a separate CSS request', () => {
  const dispose = installArkmeRedesignStyles()
  const dialog = document.createElement('dialog')
  dialog.className = 'device-dialog'; dialog.setAttribute('open', '')
  const header = document.createElement('header'); header.className = 'device-header'
  const links = document.createElement('div'); links.className = 'device-links'
  const button = document.createElement('button'); links.append(button)
  dialog.append(header, links); document.body.append(dialog)
  expect(getComputedStyle(dialog).borderRadius).toBe('20px')
  expect(getComputedStyle(dialog).boxSizing).toBe('border-box')
  expect(getComputedStyle(header).boxSizing).toBe('border-box')
  expect(getComputedStyle(dialog).fontSize).toBe('14px')
  expect(getComputedStyle(dialog).display).toBe('flex')
  expect(getComputedStyle(header).display).toBe('flex')
  expect(getComputedStyle(button).width).toBe('100%')
  const css = document.querySelector('style[data-plugin-css="@senguoyun/dsh-arkme/redesign"]')?.textContent
  expect(css).toContain('min(596px, calc(100vw - 32px))')
  expect(css).toContain('@media (max-width: 600px)')
  const disposeAgain = installArkmeRedesignStyles()
  expect(document.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
  disposeAgain(); dispose()
  expect(document.querySelector('style[data-plugin-css]')).toBeNull()
})
