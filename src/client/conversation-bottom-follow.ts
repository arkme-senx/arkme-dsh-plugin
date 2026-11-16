/** One cancellable latest-edge motion per viewport; data is never queued for animation. */
interface ConversationFollow {
  readonly latest: boolean
  cancel(): void
  retarget(rebased?: boolean, motion?: 'animated' | 'instant', targetTop?: number, finished?: () => void): void
}
const followers = new WeakMap<HTMLElement, ConversationFollow>()
const FOLLOW_MILLIS = 180
export function conversationWindowActive(body: HTMLElement): boolean {
  const doc = body.ownerDocument
  return doc === undefined || doc.visibilityState !== 'hidden' && (doc.hasFocus?.() ?? true)
}
export function isConversationFollowing(body: HTMLElement): boolean { return followers.get(body)?.latest === true }
export function cancelConversationFollow(body: HTMLElement): void { followers.get(body)?.cancel() }

export function followConversationBottom(body: HTMLElement, rebased = false, motion?: 'animated' | 'instant'): void {
  moveConversation(body, rebased, motion)
}

export function scrollConversationTo(body: HTMLElement, top: number, finished?: () => void): void {
  moveConversation(body, false, 'animated', top, finished)
}

function moveConversation(body: HTMLElement, rebased: boolean, motion?: 'animated' | 'instant', targetTop?: number, finished?: () => void): void {
  if (!conversationWindowActive(body)) {
    cancelConversationFollow(body)
    if (targetTop !== undefined) body.scrollTop = Math.max(0, Math.min(Math.max(0, body.scrollHeight - body.clientHeight), targetTop))
    finished?.()
    return
  }
  const current = followers.get(body)
  if (current) { current.retarget(rebased, motion, targetTop, finished); return }
  const view = body.ownerDocument?.defaultView
  if (!view || typeof view.requestAnimationFrame !== 'function') {
    body.scrollTop = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, targetTop ?? Infinity))
    finished?.()
    return
  }
  // Chromium can anchor the appended tail before our next animation frame,
  // snapping an entire row despite bounded scroll writes. Latest-follow owns
  // motion between arrivals too; restore native anchoring when reading history.
  const anchor = body.style.getPropertyValue('overflow-anchor')
  const anchorPriority = body.style.getPropertyPriority('overflow-anchor')
  body.style.setProperty('overflow-anchor', 'none', anchorPriority)
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
  let frame: number | undefined
  let target = body.scrollTop
  let from = body.scrollTop
  let previousFrame = 0
  let elapsed = 0
  let latest = targetTop === undefined
  let currentMotion = motion ?? 'animated'
  let onFinished = finished
  const cancel = () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame)
    frame = undefined
    followers.delete(body)
    if (anchor) body.style.setProperty('overflow-anchor', anchor, anchorPriority)
    else body.style.removeProperty('overflow-anchor')
    for (const type of events) body.removeEventListener(type, onInput)
    view.removeEventListener('blur', cancel)
    body.ownerDocument.removeEventListener('visibilitychange', onVisibilityChange)
    const done = onFinished
    onFinished = undefined
    done?.()
  }
  const onVisibilityChange = () => { if (!conversationWindowActive(body)) cancel() }
  const onInput = () => {
    cancel()
    // Persist user intent immediately; disposal itself must not synthesize input.
    body.dispatchEvent(new view.Event('scroll'))
  }
  const tick = (now: number) => {
    frame = undefined
    if (!followers.has(body)) return
    if (!conversationWindowActive(body)) { cancel(); return }
    // A delayed commit/frame must not consume the unseen animation and turn
    // its first painted step into a snap. One bounded motion still owns all data.
    elapsed += Math.min(24, Math.max(0, now - previousFrame))
    previousFrame = now
    const progress = Math.min(1, elapsed / FOLLOW_MILLIS)
    body.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3)
    if (progress < 1) frame = view.requestAnimationFrame(tick)
    else if (!latest) cancel()
  }
  const retarget = (rebased = false, motion?: 'animated' | 'instant', targetTop?: number, finished?: () => void) => {
    onFinished = finished
    latest = targetTop === undefined
    if (motion !== undefined) currentMotion = motion
    const next = Math.max(0, Math.min(Math.max(0, body.scrollHeight - body.clientHeight), targetTop ?? Infinity))
    if (currentMotion === 'instant') {
      // An explicit return owns the latest edge before any programmatic scroll
      // event. Deferred virtual/media layout must not restore the old history row
      // or animate a multi-screen return for tens of seconds.
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      frame = undefined
      target = next
      body.scrollTop = next
      if (!latest) cancel()
      return
    }
    // ResizeObserver/React may repeat the same target; never restart its clock.
    if (!rebased && frame !== undefined && Math.abs(next - target) <= 1) return
    target = next
    from = body.scrollTop
    if (Math.abs(target - from) <= 1) {
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      frame = undefined
      if (!latest) cancel()
      return
    }
    if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      frame = undefined
      body.scrollTop = target
      if (!latest) cancel()
      return
    }
    previousFrame = view.performance.now()
    elapsed = 0
    // Like Telegram, animate only the final screen with a fixed duration.
    if (Math.abs(target - from) > body.clientHeight) {
      from = target - Math.sign(target - from) * body.clientHeight
      body.scrollTop = from
    }
    if (frame === undefined) frame = view.requestAnimationFrame(tick)
  }
  followers.set(body, { get latest() { return latest }, cancel, retarget })
  for (const type of events) body.addEventListener(type, onInput, { passive: true })
  view.addEventListener('blur', cancel)
  body.ownerDocument.addEventListener('visibilitychange', onVisibilityChange)
  retarget(rebased, motion, targetTop, finished)
}
