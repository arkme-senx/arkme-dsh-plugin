/** Private presentation bridge between Arkme and its existing same-origin Harness frame. */
export const HARNESS_MENU_OPEN = 'arkme:harness-menu-open'
export const HARNESS_MENU_CLOSE = 'arkme:harness-menu-close'
export const HARNESS_MENU_POSITION = 'arkme:harness-menu-position'

export interface HarnessSessionMenuRequest {
  accepted: boolean
  anchor(): { left: number; right: number; top: number; bottom: number }
  onLayout(): void
  onClose(focus: boolean): void
  onSelect(): void
}

export function harnessMenuLayers(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('[data-arkme-session-column][data-arkme-session-open], [role="menu"], [role="dialog"], [role="alertdialog"]')]
    .filter(node => node.getClientRects().length > 0 && doc.defaultView?.getComputedStyle(node).visibility !== 'hidden')
}
