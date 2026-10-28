/** Keep the bounded reaction reader attached to the viewport, not all loaded history. */
export function watchVisibleReactionTarget(node: HTMLElement | null, watch: () => () => void): () => void {
  if (!node || typeof IntersectionObserver === 'undefined') return watch()
  let release: (() => void) | undefined
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) release ??= watch()
    else { release?.(); release = undefined }
  }, { root: node.closest('.arkme-conversation-body'), rootMargin: '600px 0px' })
  observer.observe(node)
  return () => { observer.disconnect(); release?.() }
}
