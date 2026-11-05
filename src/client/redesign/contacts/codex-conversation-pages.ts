import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { tr } from '../../locale.js'
import { codexTaskViewKey, type CodexViewState, type CodexViewTask } from './personal-codex-state.js'

export interface CodexConversationPage { state: CodexViewState; unavailable: string[]; position?:{cursor?:string|undefined;after?:string|undefined;from?:string|undefined} }
export const CODEX_CONVERSATION_PAGES=4

export function fitCodexConversationPages(pages:Map<number,CodexConversationPage>,direction:'older'|'newer') {
  while(pages.size>CODEX_CONVERSATION_PAGES)pages.delete(direction==='older'?Math.min(...pages.keys()):Math.max(...pages.keys()))
}

export const codexTaskPage=(state:CodexViewState)=>state.localTaskPage??(state.localOnly?undefined:state.cloud)

/** Page boundaries can move when an active conversation moves to the front. */
export function mergeCodexConversationPages(pages: ReadonlyMap<number, CodexConversationPage>): CodexConversationPage {
  const ordered = [...pages].sort(([a],[b])=>a-b).map(([,value])=>value)
  const first = ordered[0]!
  const last = ordered.at(-1)!
  const tasks = new Map<string,CodexViewTask>()
  for (const page of ordered) for (const task of page.state.tasks) {
    const key = codexTaskViewKey(task)
    const previous = tasks.get(key)
    if (!previous || task.updatedAt > previous.updatedAt) tasks.set(key,task)
  }
  return {
    state: {...first.state,tasks:[...tasks.values()],...(first.state.localTaskPage?{localTaskPage:{...first.state.localTaskPage,hasMore:last.state.localTaskPage?.hasMore===true,nextCursor:last.state.localTaskPage?.nextCursor}}:{}),...(first.state.cloud ? {cloud:{...first.state.cloud,
      hasMore:last.state.cloud?.hasMore === true, nextCursor:last.state.cloud?.nextCursor,
      reviewingTasks:ordered.reduce((sum,page)=>sum+(page.state.cloud?.reviewingTasks ?? 0),0),
    }} : {})},
    unavailable:[...new Set(ordered.flatMap(page=>page.unavailable))],
  }
}

/** Use DSH's own time buckets so the two conversation selectors agree. */
export function codexConversationTime(at: number, now: number): string {
  const {unit,n}=relativeTime(at,now)
  if (unit==='now') return tr('刚刚')
  return tr({minutes:'{count}分钟',hours:'{count}小时',days:'{count}天',months:'{count}个月',years:'{count}年'}[unit],{count:n})
}
