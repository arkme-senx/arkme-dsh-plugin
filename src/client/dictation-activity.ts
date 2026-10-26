import { lockMicrophone } from './microphone-lock.js'
interface Activity { active: boolean; listeners: Set<(active: boolean) => void | Promise<void>>; cancel?: () => void }
const key = '__arkmeDictationActivityV1'
function activity(): Activity {
  let owner = globalThis as typeof globalThis & { [key]?: Activity }
  try { if (typeof window !== 'undefined' && window.parent?.location.origin === window.location.origin) owner = window.parent as unknown as typeof owner } catch { /* A standalone window owns its microphone. */ }
  return owner[key] ??= { active: false, listeners: new Set() }
}
export const dictationActive = () => activity().active
export function subscribeDictationActivity(listener: (active: boolean) => void | Promise<void>) { const state = activity(); state.listeners.add(listener); return () => { state.listeners.delete(listener) } }
export async function acquireDictation(cancel: () => void): Promise<() => void> {
  const state = activity()
  if (state.active) throw new Error('另一个输入框正在听写，请先停止后重试')
  state.active = true; state.cancel = cancel
  let releaseLock: (() => void) | undefined
  try {
    await Promise.all([...state.listeners].map(listener => listener(true)))
    releaseLock = await lockMicrophone()
  } catch (error) {
    if (state.cancel === cancel) { delete state.cancel; state.active = false; for (const listener of state.listeners) void listener(false) }
    throw error
  }
  return () => {
    releaseLock?.(); releaseLock = undefined
    if (state.cancel !== cancel) return
    delete state.cancel; state.active = false
    for (const listener of state.listeners) void listener(false)
  }
}
