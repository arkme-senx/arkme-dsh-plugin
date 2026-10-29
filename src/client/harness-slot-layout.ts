/** The history adapter adds one source anchor inside an official alias outlet.
 * Only cross that explicitly owned pair; unknown native wrappers stay unknown.
 */
export function harnessSlotBoundary(slot: HTMLElement): HTMLElement {
  const parent = slot.parentElement
  return slot.hasAttribute('data-arkme-history-slot') && parent?.hasAttribute('data-slot')
    && parent.childElementCount === 1 ? parent : slot
}
