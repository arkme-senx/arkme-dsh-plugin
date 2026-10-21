/** Target-free owner hints reread only registered visible marks, without touching the timeline. */
const listeners = new Set<(clear: boolean) => void>()
export function invalidateMessageMarks(clear = false): void { for (const listener of listeners) listener(clear) }
export function subscribeMessageMarkInvalidations(listener: (clear: boolean) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
