import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
type SubagentAddress = ReturnType<ISessions['list']['getSnapshot']>['currentAddress']

export interface DesktopSessionSelectionBridge {
  save(sessionId: string, subagentAddress?: SubagentAddress): Promise<boolean>
}

/** The embedded runtime owns selection. Visibility/presence clears must never erase it. */
export function observeHarnessSessionSelection(
  sessions: Pick<ISessions, 'list'>,
  bridge: DesktopSessionSelectionBridge | undefined,
): () => void {
  if (bridge === undefined) return () => {}
  let stopped = false
  let pending: { sessionId: string; subagentAddress: SubagentAddress; key: string; failures: number } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  const persist = async (selection: NonNullable<typeof pending>) => {
    if (stopped || pending !== selection) return
    try {
      if (!await bridge.save(selection.sessionId, selection.subagentAddress)) stopped = true
    } catch (error) {
      if (stopped || pending !== selection) return
      console.warn('Arkme could not persist the current Harness session.', error)
      // Retry only the latest selection: an old failed write must never undo a newer choice.
      if (++selection.failures <= 3) retry = setTimeout(() => { retry = undefined; void persist(selection) }, 1000)
    }
  }
  const changed = () => {
    const snapshot = sessions.list.getSnapshot()
    if (stopped || snapshot.phase !== 'ready' || !snapshot.current || !snapshot.byId[snapshot.current]) return
    const key = JSON.stringify([snapshot.current, snapshot.currentAddress])
    if (pending?.key === key) return
    if (retry !== undefined) { clearTimeout(retry); retry = undefined }
    pending = { sessionId: snapshot.current, subagentAddress: snapshot.currentAddress, key, failures: 0 }
    // Submit immediately; the main process owns serialization and drains accepted
    // writes on quit. Do not strand a later switch in a renderer-side write queue.
    void persist(pending)
  }
  const unsubscribe = sessions.list.subscribe(changed)
  changed()
  return () => {
    stopped = true
    if (retry !== undefined) clearTimeout(retry)
    unsubscribe()
  }
}
