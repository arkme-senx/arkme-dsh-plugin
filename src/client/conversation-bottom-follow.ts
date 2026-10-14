/** One cancellable latest-edge motion per viewport; data is never queued for animation. */
interface ConversationFollow {
  cancel(): void
  retarget(rebased?: boolean): void
}
const followers = new WeakMap<HTMLElement, ConversationFollow>()
const FOLLOW_MILLIS = 180
export function isConversationFollowing(body: HTMLElement): boolean { return followers.has(body) }
export function cancelConversationFollow(body: HTMLElement): void { followers.get(body)?.cancel() }

export function followConversationBottom(body: HTMLElement, rebased = false): void {
  const current = followers.get(body)
  if (current) { current.retarget(rebased); return }
  const view = body.ownerDocument?.defaultView
  if (!view || typeof view.requestAnimationFrame !== 'function') {
    body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
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
  let duration = FOLLOW_MILLIS
  const cancel = () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame)
    frame = undefined
    followers.delete(body)
    if (anchor) body.style.setProperty('overflow-anchor', anchor, anchorPriority)
    else body.style.removeProperty('overflow-anchor')
    for (const type of events) body.removeEventListener(type, onInput)
  }
  const onInput = () => {
    cancel()
    // Persist user intent immediately; disposal itself must not synthesize input.
    body.dispatchEvent(new view.Event('scroll'))
  }
  const tick = (now: number) => {
    frame = undefined
    if (!followers.has(body)) return
    // A delayed commit/frame must not consume the unseen animation and turn
    // its first painted step into a snap. One bounded motion still owns all data.
    elapsed += Math.min(24, Math.max(0, now - previousFrame))
    previousFrame = now
    const progress = Math.min(1, elapsed / duration)
    body.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3)
    if (progress < 1) frame = view.requestAnimationFrame(tick)
  }
  const retarget = (rebased = false) => {
    const next = Math.max(0, body.scrollHeight - body.clientHeight)
    // ResizeObserver/React may repeat the same target; never restart its clock.
    if (!rebased && frame !== undefined && Math.abs(next - target) <= 1) return
    target = next
    from = body.scrollTop
    if (Math.abs(target - from) <= 1) {
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      frame = undefined
      return
    }
    if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      frame = undefined
      body.scrollTop = target
      return
    }
    previousFrame = view.performance.now()
    elapsed = 0
    // easeOutCubic starts at 3 * distance / duration. Keep its peak <= 1.5px/ms
    // when the transport delivers multiple rows together; no message playback queue.
    duration = Math.max(FOLLOW_MILLIS, Math.abs(target - from) * 2)
    if (frame === undefined) frame = view.requestAnimationFrame(tick)
  }
  followers.set(body, { cancel, retarget })
  for (const type of events) body.addEventListener(type, onInput, { passive: true })
  retarget()
}
