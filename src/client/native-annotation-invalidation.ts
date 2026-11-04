const EVENT = 'arkme:native-annotations-invalidated'

/** Same-origin Arkme frames share one Host realtime owner, scoped to the login. */
export function publishNativeAnnotationInvalidation(accountScope: string, owner = typeof window === 'undefined' ? undefined : window): void {
  if (!owner || typeof owner.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return
  owner.dispatchEvent(new CustomEvent(EVENT, { detail: accountScope }))
}
export function subscribeNativeAnnotationInvalidation(accountScope: string, invalidate: () => void): () => void {
  const owner = window.frameElement?.ownerDocument.defaultView ?? window
  const receive = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail === accountScope) invalidate()
  }
  owner.addEventListener(EVENT, receive)
  return () => owner.removeEventListener(EVENT, receive)
}
