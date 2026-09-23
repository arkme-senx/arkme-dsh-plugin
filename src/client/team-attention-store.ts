import type { TeamAttention } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'

const empty: TeamAttention = Object.freeze({ external: false, team: false, applications: false })
const listeners = new Set<() => void>()
let account = '', snapshot = empty
export const subscribeTeamAttention = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const readTeamAttention = (key: string): TeamAttention => key === account ? snapshot : empty

// The persistent shell owns this runtime, even while the directory is unmounted.
// A failed Team request cannot reset Chat attention or escape into its consumer.
export function startTeamAttention(key: string, onNew: (value: TeamAttention) => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const controller = new AbortController()
  let running = false, again = false, initialized = false
  account = key; snapshot = empty
  const emit = () => { for (const listener of listeners) listener() }
  emit()
  const refresh = async () => {
    if (controller.signal.aborted) return
    if (running) { again = true; return }
    running = true
    try {
      do {
        again = false
        try {
          const value = await callArkme<TeamAttention>('team.app.attention', {}, controller.signal)
          if (controller.signal.aborted || account !== key) return
          const fresh = initialized && ((!snapshot.external && value.external) || (!snapshot.team && value.team) || (!snapshot.applications && value.applications))
          snapshot = value; initialized = true; emit()
          if (fresh) onNew(value)
        } catch { /* Keep the last known badge on Team-only failure. */ }
      } while (again && !controller.signal.aborted)
    } finally { running = false }
  }
  const focus = () => { void refresh() }
  const stop = subscribeTeamMessageChanges(changed => { if (changed === key) void refresh() })
  const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
  window.addEventListener('focus', focus)
  void refresh()
  return () => { controller.abort(); stop(); clearInterval(timer); window.removeEventListener('focus', focus); if (account === key) { account = ''; snapshot = empty; emit() } }
}
