let readIntentSuspensions = 0
const availabilityListeners = new Set<() => void>()

/** A temporary overlay can suppress automatic read acknowledgement without deactivating the conversation. */
export function suspendArkmeVisibleReadIntent(): () => void {
  readIntentSuspensions += 1
  let released = false
  return () => {
    if (released) return
    released = true
    readIntentSuspensions -= 1
    if (readIntentSuspensions === 0) for (const listener of availabilityListeners) listener()
  }
}

export function subscribeArkmeReadIntentAvailability(listener: () => void): () => void {
  availabilityListeners.add(listener)
  return () => { availabilityListeners.delete(listener) }
}

export interface ArkmeReadIntentDocument {
  readonly visibilityState?: DocumentVisibilityState
  hasFocus?(): boolean
}

export function arkmeVisibleReadIntentAllowed(
  documentRef: ArkmeReadIntentDocument | undefined = typeof document === 'undefined' ? undefined : document,
): boolean {
  if (readIntentSuspensions > 0) return false
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
