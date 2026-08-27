import type { ReactNode } from 'react'
import type { ContactDirectorySectionState } from './contact-directory-state.js'

export interface CollapsibleDirectorySectionProps {
  section: ContactDirectorySectionState
  label: string
  emptyLabel: string
  children: ReactNode
  onToggle(): void
  onRetry(): void
  onLoadMore(): void
}

export function CollapsibleDirectorySection({
  section,
  label,
  emptyLabel,
  children,
  onToggle,
  onRetry,
  onLoadMore,
}: CollapsibleDirectorySectionProps) {
  const contentId = `arkme-directory-section-${section.section}`
  const hasItems = section.items.length > 0
  return <section className="arkme-contact-directory-section" data-directory-section={section.section}>
    <button
      type="button"
      className="arkme-contact-directory-section-header"
      aria-expanded={section.expanded}
      aria-controls={contentId}
      onClick={onToggle}
    >
      <span className="arkme-contact-directory-section-title">
        <span className="arkme-contact-directory-caret" aria-hidden>›</span>
        <strong>{label}</strong>
      </span>
      <span className="arkme-contact-directory-count">{section.total}</span>
    </button>
    <div id={contentId} className="arkme-contact-directory-section-body" hidden={!section.expanded}>
      {section.expanded && hasItems && children}
      {section.expanded && section.status === 'loading' && <div role="status" className="arkme-contact-directory-status">
        {hasItems ? '正在加载更多…' : '正在加载…'}
      </div>}
      {section.expanded && section.status === 'empty' && <div className="arkme-contact-directory-empty">{emptyLabel}</div>}
      {section.expanded && section.status === 'error' && <div className="arkme-contact-directory-warning" role="alert">
        <span>{section.warning ?? '加载失败'}</span>
        <button type="button" onClick={onRetry}>重试</button>
      </div>}
      {section.expanded && section.status !== 'error' && section.warning !== undefined
        && <div className="arkme-contact-directory-warning" role="status">{section.warning}</div>}
      {section.expanded && section.hasMore && section.status !== 'loading'
        && <button type="button" className="arkme-contact-directory-more" onClick={onLoadMore}>加载更多</button>}
    </div>
  </section>
}
