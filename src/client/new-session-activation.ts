type ClosestTarget = {
  closest?(selector: string): { getAttribute?(name: string): string | null } | null
}

/** Current official DSH sidebar labels in its zh/en locale dictionaries. */
export function isOfficialNewSessionTarget(target: EventTarget | null): boolean {
  const candidate = target as ClosestTarget | null
  const button = candidate?.closest?.('button')
  const label = button?.getAttribute?.('aria-label')?.trim().toLocaleLowerCase()
  return label === '新建会话' || label === 'new session'
}

/**
 * DSH currently exposes no additive event slot for the shared New Session
 * action. Listen only while Arkme shadows `conversation`, so reusing the same
 * blank Session can still restore the native surface before the click bubbles.
 */
export function watchOfficialNewSession(
  onActivate: () => void,
  ownerDocument: Document | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  if (ownerDocument === undefined) return () => {}
  const handleClick = (event: MouseEvent) => {
    if (isOfficialNewSessionTarget(event.target)) onActivate()
  }
  ownerDocument.addEventListener('click', handleClick, true)
  return () => { ownerDocument.removeEventListener('click', handleClick, true) }
}
