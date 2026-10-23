import { useEffect, useState } from 'react'
import { callArkme } from '../../api.js'
import type { ArkmeTeamPage } from '../../../types.js'
import type { TeamCodexState } from '../../../team-codex-contract.js'
import type { CodexTeamScope } from './personal-codex-state.js'
import { readCodexActivity, type CodexActivitySnapshot } from './codex-activity.js'

/** The directory owns this poller, so changing the open conversation cannot stop it. */
export function useCodexActivity(accountKey: string | undefined, userId: number | undefined, active: boolean) {
  const [value,setValue] = useState<{accountKey:string;snapshot:CodexActivitySnapshot}>()
  useEffect(() => {
    if (!active || !accountKey || !userId) return
    const controller = new AbortController()
    const historyPages = new Map<string,{state:TeamCodexState;at:number}>()
    let busy = false
    const refresh = async () => {
      if (busy || controller.signal.aborted || typeof document !== 'undefined' && document.hidden) return
      busy = true
      const request = new AbortController()
      const abort = () => request.abort()
      controller.signal.addEventListener('abort',abort,{once:true})
      const timeout = setTimeout(abort,25_000)
      try {
        const teams = new Map<string,CodexTeamScope>(), cursors = new Set<string>()
        let cursor: string | undefined
        for (let page = 0; page < 100; page++) {
          const result = await callArkme<ArkmeTeamPage>('team.list',{limit:50,...(cursor?{pageCursor:cursor}:{})},request.signal)
          request.signal.throwIfAborted()
          for (const team of result.items) teams.set(team.teamRef,team)
          if (!result.hasMore) break
          if (page === 99 || !result.nextPageCursor || cursors.has(result.nextPageCursor)) throw Error('Incomplete teams')
          cursor = result.nextPageCursor; cursors.add(cursor)
        }
        const snapshot = await readCodexActivity([...teams.values()],String(userId),async (teamRef,page) => {
          const key = JSON.stringify([teamRef,page]), cached = historyPages.get(key)
          // Recent/running/reviewing pages are always fresh. Briefly reuse only terminal history;
          // a reactivated task moves to the fresh first page and supersedes the older snapshot.
          if (page > 1 && cached && Date.now()-cached.at < 30_000) return cached.state
          const state = await callArkme<TeamCodexState>('team.codex.state',{teamRef,page,memberRef:String(userId)},request.signal)
          request.signal.throwIfAborted()
          if (page > 1 && state.cloud?.status === 'ready' && !state.cloud.reviewingTasks
            && state.tasks.every(task=>task.state==='finished'||task.state==='interrupted')) historyPages.set(key,{state,at:Date.now()})
          else historyPages.delete(key)
          return state
        },request.signal)
        request.signal.throwIfAborted()
        setValue({accountKey,snapshot})
      } catch {
        if (!controller.signal.aborted) setValue(current=>({accountKey,snapshot:{
          tasks:current?.accountKey===accountKey?current.snapshot.tasks:[],complete:false,checkedAt:Date.now(),
        }}))
      } finally {
        clearTimeout(timeout); controller.signal.removeEventListener('abort',abort); busy = false
      }
    }
    void refresh()
    const timer = setInterval(()=>{void refresh()},10_000)
    const foreground = () => {void refresh()}
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange',foreground)
    if (typeof window !== 'undefined') window.addEventListener('focus',foreground)
    return () => {
      controller.abort(); clearInterval(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange',foreground)
      if (typeof window !== 'undefined') window.removeEventListener('focus',foreground)
    }
  },[accountKey,userId,active])
  return value?.accountKey === accountKey ? value?.snapshot : undefined
}
