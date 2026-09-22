// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'

vi.mock('../src/client/team-messaging.css?inline', async () => ({
  default: (await import('node:fs')).readFileSync(`${process.cwd()}/src/client/team-messaging.css`, 'utf8'),
}))
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

it('installs and removes Team layout through the existing plugin style lifecycle', () => {
  const dispose = installArkmeRedesignStyles()
  const backdrop = document.createElement('div')
  backdrop.className = 'team-message-backdrop'
  const panel = document.createElement('div')
  panel.className = 'team-message-panel'
  backdrop.append(panel); document.body.append(backdrop)
  expect(getComputedStyle(backdrop).position).toBe('fixed')
  expect(getComputedStyle(panel).display).toBe('flex')
  dispose()
  expect(document.querySelector('style[data-plugin-css]')).toBeNull()
})
