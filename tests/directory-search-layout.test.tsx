import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { directorySearchLayout } from '../src/client/directory-search-layout.js'
import { ContactDirectoryToolbar } from '../src/client/redesign/contacts/ContactDirectoryToolbar.js'

describe('shared directory search layout', () => {
  it('lets the wrapper grow around host padding while keeping controls 40px high', () => {
    expect(directorySearchLayout.toolbar.height).toBe('auto')
    expect(directorySearchLayout.toolbar.flex).toBe('none')
    expect(directorySearchLayout.toolbar.margin).toBe('24px 16px 16px')
    expect(directorySearchLayout.field.height).toBe(40)
    expect(directorySearchLayout.field.boxSizing).toBe('border-box')
  })

  it.each(['', 'Alice'])('keeps contacts on the same intrinsic search grid (query=%s)', value => {
    const dom = new JSDOM(renderToStaticMarkup(<ContactDirectoryToolbar value={value} onChange={() => {}} />))
    try {
      const toolbar = dom.window.document.querySelector<HTMLElement>('[role="search"]')!
      const field = toolbar.querySelector<HTMLElement>('.arkme-contact-directory-search-field')!
      expect(toolbar.classList.contains('arkme-directory-search-toolbar')).toBe(true)
      expect(toolbar.style.height).toBe('auto')
      expect(toolbar.style.margin).toBe('24px 16px 16px')
      expect(field.style.height).toBe('40px')
      expect(toolbar.querySelector('input')!.getAttribute('value')).toBe(value)
    } finally { dom.window.close() }
  })
})
