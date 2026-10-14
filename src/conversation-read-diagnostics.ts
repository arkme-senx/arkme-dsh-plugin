const operations = new Set(['source.timeline', 'source.timeline-around', 'source.members.page', 'source.members.presentation'])
let nextId = 0
let windowStarted = 0
let emitted = 0

/** Opt-in, bounded owner timing. Never log params, cursors, credentials or error text. */
export async function measureConversationRead<T>(operation: string, work: () => Promise<T>): Promise<T> {
  if (process.env.ARKME_CHAT_NOTIFICATION_DIAGNOSTICS !== '1' || !operations.has(operation)) return await work()
  const started = performance.now()
  const id = ++nextId
  let ok = false
  let failure: unknown
  try { const result = await work(); ok = true; return result }
  catch (error) { failure = error; throw error }
  finally {
    const now = Date.now()
    if (now - windowStarted >= 60_000 || now < windowStarted) { windowStarted = now; emitted = 0 }
    if (emitted < 120) {
      emitted++
      const code = failure !== null && typeof failure === 'object' && 'code' in failure ? failure.code : undefined
      console.info('dsh-arkme: conversation_read', { atMillis: now, id, operation,
        millis: Math.round(performance.now() - started), ok,
        ...(ok ? {} : { code: typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(code) ? code : 'read-failed' }),
      })
    }
  }
}
