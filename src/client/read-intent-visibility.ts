export interface ArkmeReadIntentDocument {
  readonly visibilityState?: DocumentVisibilityState
  hasFocus?(): boolean
}

export function arkmeVisibleReadIntentAllowed(
  documentRef: ArkmeReadIntentDocument | undefined = typeof document === 'undefined' ? undefined : document,
): boolean {
  if (documentRef === undefined) return true
  return documentRef.visibilityState === 'visible' && (documentRef.hasFocus?.() ?? true)
}

export async function arkmeAwaitVisibleReadIntent(
  documentRef: ArkmeReadIntentDocument | undefined = typeof document === 'undefined' ? undefined : document,
  nextFrame: () => Promise<void> = async () => {
    await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve() }) })
  },
): Promise<boolean> {
  if (!arkmeVisibleReadIntentAllowed(documentRef)) return false
  await nextFrame()
  return arkmeVisibleReadIntentAllowed(documentRef)
}
