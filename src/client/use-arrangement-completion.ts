import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { ArkmeArrangementItem } from '../types.js'
import { moveArrangement, type ArrangementColumn } from './arrangement-board-model.js'
import { prepareArrangementCompletionSound } from './arrangement-completion-sound.js'

const prefix = 'arkme:arrangements:sound:'
const listeners = new Set<() => void>()
const unavailableStorage = new Map<string, boolean>()
function enabled(scope: string) {
  if (unavailableStorage.has(scope)) return unavailableStorage.get(scope)!
  try { return localStorage.getItem(prefix + scope) !== 'off' } catch { return true }
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  const storage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(prefix)) return
    if (event.key === null) unavailableStorage.clear()
    else unavailableStorage.delete(event.key.slice(prefix.length))
    listener()
  }
  window.addEventListener('storage', storage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', storage) }
}

/** Shared sound preference and success/failure feedback; transport callers keep their own owner checks. */
export function useArrangementCompletion(accountScope: string) {
  const sound = useSyncExternalStore(subscribe, () => enabled(accountScope), () => true)
  const prepared = useRef(new Set<() => void>())
  useEffect(() => () => { for (const cancel of prepared.current) cancel(); prepared.current.clear() }, [accountScope])
  const setSound = (value: boolean) => {
    try { localStorage.setItem(prefix + accountScope, value ? 'on' : 'off'); unavailableStorage.delete(accountScope) }
    catch { unavailableStorage.set(accountScope, value) }
    for (const notify of listeners) notify()
  }
  async function transition(current: ArkmeArrangementItem | ((signal: AbortSignal) => Promise<ArkmeArrangementItem>), target: ArrangementColumn, signal: AbortSignal) {
    signal.throwIfAborted()
    const feedback = target === 'completed' && enabled(accountScope) ? prepareArrangementCompletionSound() : undefined
    let settled = false
    const settle = (play: boolean) => {
      if (settled) return
      settled = true
      try { if (play) feedback?.play(); else feedback?.cancel() } catch { /* Audio never changes a confirmed business result. */ }
    }
    const cancel = () => settle(false)
    prepared.current.add(cancel); signal.addEventListener('abort', cancel, { once: true })
    try {
      const previous = typeof current === 'function' ? await current(signal) : current
      signal.throwIfAborted()
      const result = await moveArrangement(previous, target, signal)
      signal.throwIfAborted()
      settle(target === 'completed' && previous.status !== target && enabled(accountScope))
      return { previous, result }
    } catch (error) { cancel(); throw error }
    finally { prepared.current.delete(cancel); signal.removeEventListener('abort', cancel) }
  }
  return { sound, setSound, transition }
}
