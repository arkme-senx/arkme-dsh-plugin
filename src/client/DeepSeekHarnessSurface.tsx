import type { CSSProperties } from 'react'

export const DEEPSEEK_HARNESS_EMBED_QUERY = 'arkme-harness-embed'

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff',
  },
  frame: {
    width: '100%', height: '100%', border: 0, display: 'block', background: '#fff',
  },
}

export function deepSeekHarnessEmbedRequested(search?: string): boolean {
  const resolvedSearch = search ?? (typeof window === 'undefined' ? '' : window.location?.search ?? '')
  return new URLSearchParams(resolvedSearch).get(DEEPSEEK_HARNESS_EMBED_QUERY) === '1'
}

export function deepSeekHarnessEmbedUrl(): string {
  if (typeof window === 'undefined' || window.location === undefined) {
    return `/?${DEEPSEEK_HARNESS_EMBED_QUERY}=1`
  }
  const url = new URL(window.location.pathname, window.location.origin)
  url.searchParams.set(DEEPSEEK_HARNESS_EMBED_QUERY, '1')
  return `${url.pathname}${url.search}`
}

/** Same-origin native DSH client embedded inside Arkme's existing conversation region. */
export function DeepSeekHarnessSurface() {
  return <section
    data-arkme-owned="deepseek-harness-surface"
    style={styles.root}
    aria-label="DeepSeek Harness"
  >
    <iframe
      title="DeepSeek Harness"
      src={deepSeekHarnessEmbedUrl()}
      style={styles.frame}
      allow="clipboard-read; clipboard-write; microphone"
    />
  </section>
}
