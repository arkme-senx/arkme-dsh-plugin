import { useEffect, useState } from 'react'
import type { TeamCodexEntryAvailability } from '../../../team-codex-contract.js'
import { callArkme } from '../../api.js'

/** Hidden until the host verifies this account's successful local or cloud enrollment. */
export function useCodexEntryAvailability(accountKey:string|undefined, userId:number|undefined, active:boolean):boolean {
  const [snapshot,setSnapshot] = useState<{accountKey:string;visible:boolean}>()
  useEffect(() => {
    if (!accountKey || !userId) { setSnapshot(undefined); return }
    if (!active) return
    const controller = new AbortController()
    let busy = false
    const refresh = async () => {
      if (busy || controller.signal.aborted || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      busy = true
      try {
        const value = await callArkme<TeamCodexEntryAvailability>('team.codex.entry-availability',{expectedUserId:userId},controller.signal)
        if (controller.signal.aborted || value.userId !== userId || typeof value.visible !== 'boolean' || value.checked !== true) return
        setSnapshot(previous => previous?.accountKey === accountKey && previous.visible === value.visible ? previous : {accountKey,visible:value.visible})
      } catch { /* Unknown/offline is not activation; retain only this account's last confirmed result. */ }
      finally { busy = false }
    }
    void refresh()
    const timer = setInterval(()=>{void refresh()},5000)
    const foreground = () => {void refresh()}
    if (typeof window !== 'undefined') window.addEventListener('focus',foreground)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange',foreground)
    return () => {
      controller.abort(); clearInterval(timer)
      if (typeof window !== 'undefined') window.removeEventListener('focus',foreground)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange',foreground)
    }
  },[accountKey,userId,active])
  return !!accountKey && snapshot?.accountKey === accountKey && snapshot.visible
}
