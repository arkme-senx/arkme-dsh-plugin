// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installArkmeRedesignStyles } from '../src/client/redesign/styles.js'

vi.mock('../src/client/attachment-upload.css?inline', async () => ({
  default: (await import('node:fs')).readFileSync(`${process.cwd()}/src/client/attachment-upload.css`, 'utf8'),
}))
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })

it('loads receiver progress styles through the Harness plugin style lifecycle', () => {
  const dispose = installArkmeRedesignStyles()
  document.body.innerHTML = '<span class="arkme-pending-attachment-ring"><svg></svg></span><span class="arkme-pending-attachment-bar"></span>'
  const ring = document.querySelector('.arkme-pending-attachment-ring')!
  const bar = document.querySelector('.arkme-pending-attachment-bar')!
  expect(getComputedStyle(ring).width).toBe('34px')
  expect(getComputedStyle(ring.firstElementChild!).animation).toContain('arkme-attachment-spin')
  expect(getComputedStyle(bar).height).toBe('2px')
  expect(getComputedStyle(bar).overflow).toBe('hidden')
  dispose()
  expect(document.querySelector('style[data-plugin-css]')).toBeNull()
})
