// @vitest-environment jsdom
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { HARNESS_THEME_BOOTSTRAP } from '../src/harness-theme-bootstrap.js'

const flush = async () => { await Promise.resolve(); await Promise.resolve() }
let frame: HTMLIFrameElement | undefined
afterEach(() => {
  frame?.contentWindow?.dispatchEvent(new Event('pagehide'))
  document.body.replaceChildren()
  document.body.removeAttribute('data-ds-dark-theme')
  document.body.removeAttribute('style')
})

function fixture(dark: boolean, beforeBody = false) {
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  const surface = document.createElement('section')
  surface.setAttribute('data-arkme-owned', 'deepseek-harness-surface')
  frame = document.createElement('iframe'); surface.append(frame); document.body.append(surface)
  const native = frame.contentDocument!
  if (beforeBody) native.body.remove()
  runInNewContext(HARNESS_THEME_BOOTSTRAP, { window: frame.contentWindow, document: native, MutationObserver })
  return native
}

it('paints during head parsing and applies the palette when the body arrives later', async () => {
  const native = fixture(true, true)
  expect(native.body).toBeNull()
  expect(native.documentElement.style.backgroundColor).toBe('rgb(21, 21, 23)')
  native.documentElement.append(native.createElement('body'))
  await flush()
  expect(native.body.hasAttribute('data-ds-dark-theme')).toBe(true)
})

it('paints the host palette before native content and prevents a temporary default from flashing', async () => {
  const native = fixture(true)
  expect(native.documentElement.style.colorScheme).toBe('dark')
  expect(native.documentElement.style.backgroundColor).toBe('rgb(21, 21, 23)')
  native.documentElement.style.colorScheme = 'light'
  native.body.removeAttribute('data-ds-dark-theme')
  await flush()
  expect(native.documentElement.style.colorScheme).toBe('dark')
  expect(native.body.hasAttribute('data-ds-dark-theme')).toBe(true)
  document.body.removeAttribute('data-ds-dark-theme')
  await flush()
  expect(native.documentElement.style.colorScheme).toBe('light')
  expect(native.body.hasAttribute('data-ds-dark-theme')).toBe(false)
})

it('follows a live parent theme change and releases observers on navigation', async () => {
  const native = fixture(false)
  document.body.setAttribute('data-ds-dark-theme', '')
  await flush()
  expect(native.body.hasAttribute('data-ds-dark-theme')).toBe(true)
  frame!.contentWindow!.dispatchEvent(new Event('pagehide'))
  document.body.removeAttribute('data-ds-dark-theme')
  await flush()
  expect(native.body.hasAttribute('data-ds-dark-theme')).toBe(true)
})

it('does not alter a standalone or unrelated iframe', () => {
  expect(() => runInNewContext(HARNESS_THEME_BOOTSTRAP, { window: { frameElement: null } })).not.toThrow()
})
