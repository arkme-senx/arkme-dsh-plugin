interface ArkmeRetryableErrorShape {
  body?: { retryable?: unknown }
}

function errorName(error: unknown): string {
  return error !== null && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isArkmeRequestAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true || errorName(error) === 'AbortError') return true
  const message = errorText(error).toLowerCase()
  return message.includes('signal is aborted') || message.includes('request aborted')
}

function isRetryableReadFailure(error: unknown): boolean {
  const body = error !== null && typeof error === 'object'
    ? (error as ArkmeRetryableErrorShape).body
    : undefined
  if (body?.retryable === true || error instanceof TypeError) return true
  const message = errorText(error).toLowerCase()
  return message === 'failed to fetch' || message.includes('networkerror') || message.includes('fetch failed')
}

function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const abort = () => {
      globalThis.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Retry only idempotent UI reads after short-lived transport failures. */
export async function retryArkmeRead<T>(
  read: () => Promise<T>,
  options: { signal?: AbortSignal; retryDelays?: readonly number[] } = {},
): Promise<T> {
  const retryDelays = options.retryDelays ?? [0, 250, 750, 1_500, 3_000]
  let attempt = 0
  while (true) {
    try {
      return await read()
    } catch (error) {
      if (isArkmeRequestAbort(error, options.signal) || !isRetryableReadFailure(error)
        || attempt >= retryDelays.length) throw error
      await waitForRetry(retryDelays[attempt] ?? 0, options.signal)
      attempt += 1
    }
  }
}
