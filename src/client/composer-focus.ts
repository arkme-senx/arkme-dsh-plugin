export interface ArkmeComposerFocusTarget {
  disabled: boolean
  value: string
  focus(options?: FocusOptions): void
  setSelectionRange(start: number, end: number): void
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
