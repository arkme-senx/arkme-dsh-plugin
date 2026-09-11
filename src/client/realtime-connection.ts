/** Keep background notifications without occupying an HTTP/1 read connection. */
export function connectArkmeRealtime(callbacks: {
  onOpen: () => void
  onMessage: (event: MessageEvent<string>) => void
  onDisconnect: () => void
}): { close(): void } {
  let stopped = false
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let delay = 1000
  const reconnect = () => {
    if (stopped || retry !== undefined) return
    callbacks.onDisconnect()
    retry = setTimeout(() => { retry = undefined; connect() }, delay)
    delay = Math.min(delay * 2, 10_000)
  }
  const connect = () => {
    if (stopped) return
    let next: WebSocket
    try { next = new WebSocket('/arkme-self/api/events') }
    catch { reconnect(); return }
    socket = next
    next.onopen = () => { if (!stopped && socket === next) { delay = 1000; callbacks.onOpen() } }
    next.onmessage = event => { if (!stopped && socket === next) callbacks.onMessage(event) }
    next.onerror = () => { if (!stopped && socket === next) callbacks.onDisconnect() }
    next.onclose = () => { if (socket === next) socket = undefined; reconnect() }
  }
  connect()
  return { close() {
    stopped = true
    if (retry !== undefined) clearTimeout(retry)
    if (socket !== undefined) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
      socket = undefined
    }
  } }
}
