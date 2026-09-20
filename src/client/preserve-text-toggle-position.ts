import { flushSync } from 'react-dom'

/** Preserve the toggle's viewport position in both directions, as in a reverse list. */
export function preserveTextTogglePosition(button: HTMLElement, toggle: () => void): void {
  const before = button.getBoundingClientRect().bottom
  flushSync(toggle)
  let scrollport = button.parentElement
  while (scrollport !== null && (
    !/^(auto|scroll|overlay)$/u.test(getComputedStyle(scrollport).overflowY)
    || scrollport.scrollHeight <= scrollport.clientHeight
  )) {
    scrollport = scrollport.parentElement
  }
  if (scrollport !== null) {
    // Measure the remaining movement so browser scroll anchoring is not applied twice.
    scrollport.scrollTo({ top: scrollport.scrollTop + button.getBoundingClientRect().bottom - before, behavior: 'instant' })
  }
}
