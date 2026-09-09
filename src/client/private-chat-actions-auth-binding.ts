import { arkmeAuthStore, type ArkmeAuthStore } from './auth-store.js'
import { privateChatActions, type PrivateChatActionsStore } from './private-chat-actions-store.js'

/** Observe every auth transition, including logout/login batched into one React render. */
export function bindPrivateChatActionsAuth(auth: Pick<ArkmeAuthStore, 'subscribe' | 'getSnapshot'>, actions: PrivateChatActionsStore): () => void {
  let previous: string | undefined
  const sync = () => {
    const snapshot = auth.getSnapshot().auth
    const userId = snapshot?.status === 'authenticated' ? snapshot.userId : undefined
    const account = userId === undefined ? undefined : `${snapshot!.environment}:${userId}`
    actions.activateAccount(account)
    if (account !== undefined && userId !== undefined && previous !== account) {
      void actions.identity.refresh(account, { account, userId }, false).catch(() => undefined)
    }
    previous = account
  }
  sync()
  return auth.subscribe(sync)
}

bindPrivateChatActionsAuth(arkmeAuthStore, privateChatActions)
