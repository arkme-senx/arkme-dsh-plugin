/** The embedded client shares the host's presentation, including its pre-plugin interval. */
function bootstrapHarnessTheme(): void {
  const frame = window.frameElement
  if (frame?.parentElement?.getAttribute('data-arkme-owned') !== 'deepseek-harness-surface') return
  const host = frame.ownerDocument
  const root = document.documentElement
  let observedBody: HTMLElement | undefined
  const sync = () => {
    if (document.body && document.body !== observedBody) {
      observedBody = document.body
      observer.observe(observedBody, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    }
    const dark = host.body.hasAttribute('data-ds-dark-theme')
    const scheme = dark ? 'dark' : 'light'
    if (root.style.colorScheme !== scheme) root.style.colorScheme = scheme
    if (document.body?.hasAttribute('data-ds-dark-theme') !== dark) {
      document.body?.toggleAttribute('data-ds-dark-theme', dark)
    }
    // Paint the HTML canvas before body, CSS bundles, or the native layout exist.
    const background = host.defaultView!.getComputedStyle(host.body).getPropertyValue('--dsw-alias-bg-base').trim()
      || (dark ? '#151517' : '#ffffff')
    if (root.style.backgroundColor !== background) root.style.backgroundColor = background
  }
  const observer = new MutationObserver(sync)
  observer.observe(host.documentElement, { attributes: true, attributeFilter: ['style'] })
  observer.observe(host.body, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme'] })
  // The native presenter may temporarily apply its default while settings load.
  // Match the parent until that shared settings update reaches both documents.
  observer.observe(root, { childList: true })
  sync()
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true })
}

export const HARNESS_THEME_BOOTSTRAP = `(${bootstrapHarnessTheme.toString()})()`
