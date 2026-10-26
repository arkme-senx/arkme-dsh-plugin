/** Created from the completion gesture; no network or media permission needed. */
export function prepareArrangementCompletionSound(): { play(): void; cancel(): void } | undefined {
  if (typeof window === 'undefined' || !window.AudioContext) return
  try {
    const context = new window.AudioContext()
    void context.resume().catch(() => {})
    let ended = false
    const close = () => { if (!ended) { ended = true; void context.close().catch(() => {}) } }
    const expiry = setTimeout(close, 35_000)
    const play = () => {
      clearTimeout(expiry)
      if (ended || context.state !== 'running') { close(); return }
      const at = context.currentTime
      try {
        for (const [frequency, delay] of [[1046.5, 0], [1568, 0.065]] as const) {
          const oscillator = context.createOscillator(), gain = context.createGain()
          oscillator.type = 'sine'; oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, at + delay)
          gain.gain.exponentialRampToValueAtTime(0.055, at + delay + 0.012)
          gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + 0.32)
          oscillator.connect(gain); gain.connect(context.destination)
          oscillator.start(at + delay); oscillator.stop(at + delay + 0.35)
        }
        setTimeout(close, 500)
      } catch { close() /* Sound failure must not turn a confirmed completion into a failed task. */ }
    }
    return { play, cancel: () => { clearTimeout(expiry); close() } }
  } catch { return }
}
