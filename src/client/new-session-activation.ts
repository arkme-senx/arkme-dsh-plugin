type ClosestTarget = {
  closest?(selector: string): ClosestElement | null
}

type ClosestElement = {
  getAttribute?(name: string): string | null
  closest?(selector: string): ClosestElement | null
}

/** Current official DSH sidebar labels in its zh/en locale dictionaries. */
export function isOfficialNewSessionTarget(target: EventTarget | null): boolean {
  const candidate = target as ClosestTarget | null
  const button = candidate?.closest?.('button')
  const label = button?.getAttribute?.('aria-label')?.trim().toLocaleLowerCase()
  return label === '新建会话' || label === 'new session'
}

/** A session or workspace row inside the official DSH session tree. */
export function isOfficialConversationTarget(target: EventTarget | null): boolean {
  const candidate = target as ClosestTarget | null
  const item = candidate?.closest?.('[role="treeitem"]')
  const tree = item?.closest?.('[role="tree"]')
  const label = tree?.getAttribute?.('aria-label')?.trim().toLocaleLowerCase()
  const expanded = item?.getAttribute?.('aria-expanded')
  return expanded === null && (label === '会话' || label === 'sessions')
}

function watchCapturedClick(
  matches: (target: EventTarget | null) => boolean,
  onActivate: () => void,
  ownerDocument: Document | undefined,
): () => void {
  if (ownerDocument === undefined) return () => {}
  const handleClick = (event: MouseEvent) => {
    if (matches(event.target)) onActivate()
  }
  ownerDocument.addEventListener('click', handleClick, true)
  return () => { ownerDocument.removeEventListener('click', handleClick, true) }
}

/**
 * DSH currently exposes no additive event slot for the shared New Session
 * action. Listen only while Arkme is open so the floating panel and directory
 * close before the official action handles the click.
 */
export function watchOfficialNewSession(
  onActivate: () => void,
  ownerDocument: Document | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  return watchCapturedClick(isOfficialNewSessionTarget, onActivate, ownerDocument)
}

/** Close Arkme before the official DSH session tree handles the same click. */
export function watchOfficialConversationSelection(
  onActivate: () => void,
  ownerDocument: Document | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  return watchCapturedClick(isOfficialConversationTarget, onActivate, ownerDocument)
}
