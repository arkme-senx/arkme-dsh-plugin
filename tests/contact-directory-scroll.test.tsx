// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollapsibleDirectorySection } from '../src/client/redesign/contacts/CollapsibleDirectorySection.js'
import { createContactDirectoryState } from '../src/client/redesign/contacts/contact-directory-state.js'
import { ContactDirectorySurface } from '../src/client/redesign/contacts/ContactDirectorySurface.js'
import type { ArkmeDirectoryPage, ArkmeDirectorySectionKind } from '../src/types.js'

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

describe('directory scroll-driven loading and implicit recovery', () => {
  it('loads at the scroll boundary once per page, stops when hidden, and never renders load-more buttons', async () => {
    const observations: Array<{ target?: Element; callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal('IntersectionObserver', class {
      entry: typeof observations[number]
      constructor(callback: IntersectionObserverCallback) { this.entry = { callback, disconnect: vi.fn() }; observations.push(this.entry) }
      observe(target: Element) { this.entry.target = target }
      disconnect() { this.entry.disconnect() }
    })
    const loadPage = vi.fn(async (section: ArkmeDirectorySectionKind, options: { cursor?: string }): Promise<ArkmeDirectoryPage> => ({
      section, items: section === 'contacts' ? [{ kind: 'contact', contactRef: options.cursor ?? 'first', displayName: '联系人', nickname: '', remark: '', letter: '#' }] : [],
      total: section === 'contacts' ? 3 : 0, hasMore: section === 'contacts' && options.cursor !== 'p3',
      ...(section === 'contacts' && options.cursor !== 'p3' ? { nextCursor: options.cursor ? 'p3' : 'p2' } : {}), coverage: 'complete',
    }))
    const props = { accountKey: 'a', onSelectionChange() {}, onOpenGroup() {}, onOpenBot() {}, loadPage }
    await act(async () => { root.render(<ContactDirectorySurface {...props} />) })
    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts')).toHaveLength(1)
    expect(host.textContent).not.toContain('加载更多')
    const tail = () => observations.filter(entry => entry.target?.getAttribute('data-directory-page-sentinel') === 'contacts').at(-1)!
    const enter = (entry: typeof observations[number]) => entry.callback([{ isIntersecting: true, target: entry.target } as IntersectionObserverEntry], {} as IntersectionObserver)
    const first = tail()
    await act(async () => { enter(first); enter(first) })
    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts')).toHaveLength(2)
    const second = tail()
    await act(async () => { root.render(<ContactDirectorySurface {...props} active={false} />) })
    expect(second.disconnect).toHaveBeenCalled()
    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts')).toHaveLength(2)
    await act(async () => { root.render(<ContactDirectorySurface {...props} />) })
    await act(async () => { enter(tail()) })
    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts').map(([, options]) => options.cursor)).toEqual([undefined, 'p2', 'p3'])
    expect(host.querySelector('[data-directory-page-sentinel="contacts"]')).toBeNull()
  })

  it('implicitly refreshes a failed section when the network returns, without repeating an exhausted Host request on its own', async () => {
    let healthy = false
    const failure = Object.assign(new Error('联系人暂时无法显示'), { body: { retryable: true, recovery: { owner: 'host', exhausted: true } } })
    const loadPage = vi.fn(async (section: ArkmeDirectorySectionKind): Promise<ArkmeDirectoryPage> => {
      if (section === 'contacts' && !healthy) throw failure
      return { section, items: [], total: 0, hasMore: false, coverage: 'complete' }
    })
    await act(async () => { root.render(<ContactDirectorySurface accountKey="a" loadPage={loadPage} onSelectionChange={() => {}} onOpenGroup={() => {}} onOpenBot={() => {}} />) })
    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts')).toHaveLength(1)
    expect(host.textContent).not.toContain('暂无联系人')
    expect(host.textContent).not.toContain('重试')
    healthy = true
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts')).toHaveLength(2)
    expect(host.textContent).toContain('暂无联系人')
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(loadPage.mock.calls.filter(([section]) => section === 'contacts')).toHaveLength(2)
  })
})
