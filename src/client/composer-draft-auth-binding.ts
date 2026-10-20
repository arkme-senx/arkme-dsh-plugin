import { arkmeAuthStore } from './auth-store.js'
import { arkmeComposerDraftStore } from './composer-draft-store.js'

function authenticatedAccount(): {userId: number; key: string} | undefined {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' && auth.userId !== undefined ? {userId: auth.userId, key: `${auth.environment}:${auth.userId}`} : undefined
}

let activeAccount = authenticatedAccount()

arkmeAuthStore.subscribe(() => {
  const next = authenticatedAccount()
  if (activeAccount !== undefined && activeAccount.key !== next?.key) {
    arkmeComposerDraftStore.clearAccount(activeAccount.userId)
  }
  activeAccount = next
})
