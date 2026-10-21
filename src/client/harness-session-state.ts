import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

/** Main-view ownership is public; the Controller catalog no longer owns selection. */
export function currentHarnessSession(state: SessionListState): SessionId | undefined {
  return Object.values(state.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id
}

export type HarnessSessionList = SessionListState & {
  current?: SessionId | undefined
  currentAddress?: ReturnType<ISessions['subagentAddress']>
}
export type HarnessSessions = Omit<ISessions, 'list'> & {
  list: { getSnapshot(): HarnessSessionList; subscribe(listener: () => void): () => void }
  open(target: Parameters<Context['uiWorkspace']['openSession']>[0]): void
}

/** Adapt old Arkme readers through public Controller ownership and UI navigation. */
export function harnessSessions(ctx: Context): HarnessSessions {
  // Host and Client share the Cordis module name in this full-stack build.
  const sessions = ctx.sessions as unknown as ISessions
  let previous: SessionListState | undefined
  let projected: HarnessSessionList
  const list = {
    subscribe: sessions.list.subscribe,
    getSnapshot(): HarnessSessionList {
      const state = sessions.list.getSnapshot()
      if (state !== previous) {
        previous = state
        const current = currentHarnessSession(state)
        projected = { ...state, current, currentAddress: current === undefined ? undefined : sessions.subagentAddress(current) }
      }
      return projected
    },
  }
  const methods = new Map<PropertyKey, unknown>()
  return new Proxy(sessions, {
    get(target, key) {
      if (key === 'list') return list
      if (key === 'open') return (id: Parameters<HarnessSessions['open']>[0]) => ctx.uiWorkspace.openSession(id)
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      if (!methods.has(key)) methods.set(key, value.bind(target))
      return methods.get(key)
    },
  }) as unknown as HarnessSessions
}
