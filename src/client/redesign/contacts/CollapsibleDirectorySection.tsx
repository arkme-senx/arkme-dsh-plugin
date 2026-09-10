import { useEffect, useRef, type ReactNode } from 'react'
import type { ContactDirectorySectionState } from './contact-directory-state.js'

export interface CollapsibleDirectorySectionProps {
  section: ContactDirectorySectionState
  label: string
  emptyLabel: string
  countLabel?: string
  active?: boolean
  children: ReactNode
  onToggle(): void
  onRetry(): void
  onLoadMore(): void
}

export function CollapsibleDirectorySection({
  section,
  label,
  emptyLabel,
  countLabel,
  active = true,
  children,
  onToggle,
  onRetry,
  onLoadMore,
}: CollapsibleDirectorySectionProps) {
  const contentId = `arkme-directory-section-${section.section}`
  const hasItems = section.items.length > 0
  const sectionRef = useRef<HTMLElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef(onLoadMore)
  loadMoreRef.current = onLoadMore
  useEffect(() => {
    const sentinel = sentinelRef.current
    const directory = sectionRef.current?.closest<HTMLElement>('.arkme-contact-directory')
    if (!active || !section.expanded || !section.hasMore || section.status !== 'ready' || sentinel === null || !directory) return
    let requested = false
    const load = () => { if (!requested) { requested = true; loadMoreRef.current() } }
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) load()
      }, { root: directory, rootMargin: '0px 0px 240px 0px' })
      observer.observe(sentinel)
      return () => { requested = true; observer.disconnect() }
    }
    // Embedded browsers without IntersectionObserver use the same scroll boundary.
    const check = () => {
      const bounds = directory.getBoundingClientRect()
      const target = sentinel.getBoundingClientRect()
      if (bounds.height > 0 && target.top <= bounds.bottom + 240 && target.bottom >= bounds.top) load()
    }
    check()
    directory.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { requested = true; directory.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [active, section.expanded, section.hasMore, section.status, section.generation, section.nextCursor])
  const handleToggle = () => {
    const element = sectionRef.current
    const directory = element?.closest<HTMLElement>('.arkme-contact-directory')
    if (section.expanded && element && directory) {
      const offset = element.getBoundingClientRect().top
        - directory.getBoundingClientRect().top - directory.clientTop
      // Keep the clicked header visible when its scrolled-away body disappears.
      if (offset < 0) directory.scrollTop = Math.max(0, directory.scrollTop + offset)
    }
    onToggle()
  }
  return <section ref={sectionRef} className="arkme-contact-directory-section" data-directory-section={section.section}>
    <button
      type="button"
      className="arkme-contact-directory-section-header"
      aria-expanded={section.expanded}
      aria-controls={contentId}
      onClick={handleToggle}
    >
      <span className="arkme-contact-directory-section-title">
        <span className="arkme-contact-directory-caret" aria-hidden>›</span>
        <strong>{label}</strong>
      </span>
      <span className="arkme-contact-directory-count">{countLabel ?? (section.status === 'idle' || (section.status === 'loading' && !hasItems) || (section.coverage === 'partial' && section.section === 'contacts') || (section.status === 'error' && !hasItems) ? '…' : `${section.total}${section.coverage === 'partial' ? '+' : ''}`)}</span>
    </button>
    <div id={contentId} className="arkme-contact-directory-section-body" hidden={!section.expanded}>
      {section.expanded && hasItems && children}
      {section.expanded && section.status === 'loading' && <div role="status" className="arkme-contact-directory-status">
        {hasItems && section.loadingMode === 'replace' ? '正在更新…' : '正在加载…'}
      </div>}
      {section.expanded && section.status === 'empty' && <div className="arkme-contact-directory-empty">{emptyLabel}</div>}
      {section.expanded && section.status === 'error' && <div className="arkme-contact-directory-warning" role="alert">
        <span>{section.warning ?? '加载失败'}</span>
        <button type="button" onClick={onRetry}>刷新</button>
      </div>}
      {section.expanded && section.status !== 'error' && section.status !== 'loading' && section.warning !== undefined
        && <div className="arkme-contact-directory-warning" role="status">
          <span>{section.warning}</span><button type="button" onClick={onRetry}>刷新</button>
        </div>}
      {section.expanded && section.hasMore && <div ref={sentinelRef} data-directory-page-sentinel={section.section} aria-hidden style={{ height: 1 }} />}
    </div>
  </section>
}
