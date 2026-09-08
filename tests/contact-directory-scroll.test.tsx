// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollapsibleDirectorySection } from '../src/client/redesign/contacts/CollapsibleDirectorySection.js'
import { createContactDirectoryState } from '../src/client/redesign/contacts/contact-directory-state.js'

let host: HTMLDivElement
let root: Root

function Harness({ initiallyExpanded = true }: { initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  return <nav className="arkme-contact-directory">
    <CollapsibleDirectorySection
      section={{ ...createContactDirectoryState('account-a').sections.contacts, expanded }}
      label="联系人" emptyLabel="暂无联系人"
      onToggle={() => { setExpanded(value => !value) }}
      onRetry={() => {}} onLoadMore={() => {}}
    ><div /></CollapsibleDirectorySection>
  </nav>
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(sectionTop: number, initiallyExpanded = true) {
  act(() => { root.render(<Harness initiallyExpanded={initiallyExpanded} />) })
  const nav = host.querySelector('nav')!
  const section = host.querySelector('section')!
  const header = host.querySelector('button')!
  // jsdom has no layout; supply the measured scrollport and section bounds.
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 500))
  vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, sectionTop, 300, 900))
  Object.defineProperty(nav, 'clientTop', { value: 2 })
  nav.scrollTop = 500
  return { nav, header }
}

describe('contact section collapse scroll position', () => {
  it('returns to the section start when collapsing a pinned header, including the scrollport border', () => {
    const { nav, header } = mount(-100)
    act(() => { header.click() })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(nav.scrollTop).toBe(298)
  })

  it('keeps the current scroll position when the expanded section has not reached the top', () => {
    const { nav, header } = mount(180)
    act(() => { header.click() })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(nav.scrollTop).toBe(500)
  })

  it('does not reposition the list when opening a collapsed section', () => {
    const { nav, header } = mount(-100, false)
    act(() => { header.click() })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(nav.scrollTop).toBe(500)
  })
})
