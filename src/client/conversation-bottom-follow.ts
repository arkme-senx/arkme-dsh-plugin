/** One cancellable animation per scrollport; React and persistence never own frames. */
const followers = new WeakMap<HTMLElement, { cancel(): void; wake(): void }>()
export function isConversationFollowing(body: HTMLElement): boolean { return followers.has(body) }
export function cancelConversationFollow(body: HTMLElement): void { followers.get(body)?.cancel() }

export function followConversationBottom(body: HTMLElement): void {
  const existing = followers.get(body)
  if (existing) { existing.wake(); return }
  const view = body.ownerDocument?.defaultView
  if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof view.requestAnimationFrame !== 'function') {
    body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight)
    return
  }
  let frame = 0
  let previous = view.performance.now()
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
  const cancel = () => {
    view.cancelAnimationFrame(frame)
    followers.delete(body)
    for (const type of events) body.removeEventListener(type, onInput)
  }
  const onInput = () => {
    cancel()
    // Persist the interrupted position even when selection/keyboard input does
    // not produce another native scroll. Scope disposal must never emit this.
    body.dispatchEvent(new view.Event('scroll'))
  }
  const tick = (now: number) => {
    const target = Math.max(0, body.scrollHeight - body.clientHeight)
    const distance = target - body.scrollTop
    if (Math.abs(distance) <= 1) {
      body.scrollTop = target
      frame = 0
      return
    }
    // Retarget continuously without restarting a native smooth-scroll animation.
    const elapsed = Math.min(64, Math.max(1, now - previous))
    previous = now
    body.scrollTop += distance * (1 - Math.exp(-elapsed / 45))
    frame = view.requestAnimationFrame(tick)
  }
  const wake = () => {
    if (frame || Math.abs(body.scrollHeight - body.clientHeight - body.scrollTop) <= 1) return
    previous = view.performance.now()
    frame = view.requestAnimationFrame(tick)
  }
  followers.set(body, { cancel, wake })
  for (const type of events) body.addEventListener(type, onInput, { passive: true })
  wake()
}
