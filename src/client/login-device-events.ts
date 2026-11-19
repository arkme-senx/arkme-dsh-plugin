type Listener = (connected: boolean | undefined) => void
const listeners = new Set<(accountScope: string, connected: boolean | undefined) => void>()
let connection: { accountScope: string; connected: boolean | undefined } | undefined

export function publishLoginDeviceChange(accountScope: string, connected: boolean | undefined): void {
  if (connected === false && connection?.accountScope === accountScope && connection.connected === false) return
  connection = { accountScope, connected }
  for (const listener of listeners) listener(accountScope, connected)
}

export function loginDeviceConnection(accountScope: string): boolean | undefined {
  return connection?.accountScope === accountScope ? connection.connected : undefined
}

export function subscribeLoginDeviceChanges(accountScope: string, listener: Listener): () => void {
  const scoped = (scope: string, connected: boolean | undefined) => {
    if (scope === accountScope) listener(connected)
  }
  listeners.add(scoped)
  return () => { listeners.delete(scoped) }
}
