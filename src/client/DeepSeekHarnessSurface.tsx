import type { CSSProperties } from 'react'

export const DEEPSEEK_HARNESS_EMBED_QUERY = 'arkme-harness-embed'

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff', position: 'absolute', inset: 0,
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

/**
 * Same-origin native DSH client embedded inside Arkme's existing conversation region.
 *
 * It stays mounted while another Arkme conversation is visible so the native client can
 * finish its own plugin boot independently of the Arkme directory request lifecycle.
 */
export function DeepSeekHarnessSurface({ visible = true }: { visible?: boolean }) {
  return <section
    data-arkme-owned="deepseek-harness-surface"
    data-arkme-preload="true"
    data-arkme-visible={visible ? 'true' : 'false'}
    style={{
      ...styles.root,
      visibility: visible ? 'visible' : 'hidden',
      pointerEvents: visible ? 'auto' : 'none',
      zIndex: visible ? 1 : 0,
    }}
    aria-hidden={visible ? undefined : true}
    aria-label="DeepSeek Harness"
  >
    <iframe
      title="DeepSeek Harness"
      src={deepSeekHarnessEmbedUrl()}
      style={styles.frame}
      loading="eager"
      allow="clipboard-read; clipboard-write; microphone"
    />
  </section>
}
