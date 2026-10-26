const EVENT = 'arkme:native-annotations-invalidated'

/** Same-origin Arkme frames share one Host realtime owner, scoped to the login. */
export function publishNativeAnnotationInvalidation(accountScope: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: accountScope }))
}
export function subscribeNativeAnnotationInvalidation(accountScope: string, invalidate: () => void): () => void {
  const owner = window.frameElement?.ownerDocument.defaultView ?? window
  const receive = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail === accountScope) invalidate()
  }
  owner.addEventListener(EVENT, receive)
  return () => owner.removeEventListener(EVENT, receive)
}
