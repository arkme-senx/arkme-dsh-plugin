let sequence = 0
let runSequence = 0

/** Structured lifecycle metadata only: never pass profile payloads, input text, or credentials. */
export function homeTourDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  try {
    console.info('[ArkmeHomeTour]', JSON.stringify({
      sequence: ++sequence, at: new Date().toISOString(),
      documentTimeOrigin: typeof performance === 'undefined' ? undefined : performance.timeOrigin,
      inFrame: typeof window === 'undefined' ? undefined : window !== window.top,
      event, ...details,
    }))
  } catch { /* Diagnostics must never affect onboarding or storage. */ }
}

export function createHomeTourTrace() {
  const run = ++runSequence
  let previous = ''
  return (event: string, details: Record<string, unknown> = {}) => {
    const signature = JSON.stringify({ event, ...details })
    if (signature === previous) return
    previous = signature
    homeTourDiagnostic(event, { run, ...details })
  }
}
