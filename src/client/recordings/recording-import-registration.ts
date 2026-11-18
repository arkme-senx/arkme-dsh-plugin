/** Registration retries independently of the stage/upload queue. The caller has already committed its manifest. */
export async function registerImportManifest<T>(request: () => Promise<T>, signal: AbortSignal, onWaiting: () => void): Promise<T> {
  while (true) {
    signal.throwIfAborted()
    try { return await request() }
    catch (error) {
      signal.throwIfAborted()
      const detail = error as { retryable?: boolean; body?: { retryable?: boolean } }
      if (detail?.retryable === false || detail?.body?.retryable === false) throw error
      onWaiting()
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 15_000)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
  }
}
