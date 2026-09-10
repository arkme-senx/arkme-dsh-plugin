export interface ArkmeComposerFocusTarget {
  disabled: boolean
  value: string
  focus(options?: FocusOptions): void
  setSelectionRange(start: number, end: number): void
}

export function focusArkmeComposerFromClick(
  target: ArkmeComposerFocusTarget | null,
  event: { currentTarget: HTMLElement; target: EventTarget | null; button: number; defaultPrevented: boolean },
): boolean {
  if (target === null || target.disabled || event.button !== 0 || event.defaultPrevented) return false
  const container = event.currentTarget
  const clicked = event.target
  if (!(clicked instanceof Element) || !container.contains(clicked)) return false
  // Toolbar whitespace can focus the editor; its controls keep their own action.
  if (clicked.closest('[data-arkme-composer-footer="hint"], button, a[href], input, select, textarea, [contenteditable], [role="button"], [role="link"], [role="option"], [role="menuitem"], [role="separator"], [draggable="true"]')) return false
  const active = container.ownerDocument.activeElement
  if (active !== null && container.contains(active) && active.matches('[data-arkme-rich-composer]')) return false
  // A drag can end in a click after selecting reference text or crossing padding.
  const selection = container.ownerDocument.getSelection()
  if (selection !== null && !selection.isCollapsed
    && (container.contains(selection.anchorNode) || container.contains(selection.focusNode))) return false

  target.focus({ preventScroll: true })
  return true
}

export function restoreArkmeComposerFocus(
  target: ArkmeComposerFocusTarget | null,
  activeElement: Element | null,
  bodyElement: HTMLElement | null,
  activeElementBelongsToComposer: boolean,
): boolean {
  if (target === null || target.disabled) return false
  if (activeElement !== null && activeElement !== bodyElement && !activeElementBelongsToComposer) return false

  target.focus({ preventScroll: true })
  const cursor = target.value.length
  target.setSelectionRange(cursor, cursor)
  return true
}
