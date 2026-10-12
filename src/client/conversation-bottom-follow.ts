/** Latest-edge intent survives deferred layout; incoming messages never animate the scrollport. */
const followers = new WeakMap<HTMLElement, { cancel(): void }>()
export function isConversationFollowing(body: HTMLElement): boolean { return followers.has(body) }
export function cancelConversationFollow(body: HTMLElement): void { followers.get(body)?.cancel() }

export function followConversationBottom(body: HTMLElement): void {
  const view = body.ownerDocument?.defaultView
  if (view && !followers.has(body)) {
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    const cancel = () => {
      followers.delete(body)
      for (const type of events) body.removeEventListener(type, onInput)
    }
    const onInput = () => {
      cancel()
      // Persist explicit reading intent; disposal must never synthesize a scroll.
      body.dispatchEvent(new view.Event('scroll'))
    }
    followers.set(body, { cancel })
    for (const type of events) body.addEventListener(type, onInput, { passive: true })
  }
  // Called only by layout/resize owners, before paint. Like a native reversed
  // chat viewport, the latest edge is already aligned when new content appears.
  const target = Math.max(0, body.scrollHeight - body.clientHeight)
  if (Math.abs(target - body.scrollTop) > 1) body.scrollTop = target
}
