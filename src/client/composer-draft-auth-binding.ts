import { arkmeAuthStore } from './auth-store.js'
import { arkmeComposerDraftStore } from './composer-draft-store.js'

function authenticatedUserId(): number | undefined {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? auth.userId : undefined
}

let activeAuthenticatedUserId = authenticatedUserId()

arkmeAuthStore.subscribe(() => {
  const nextUserId = authenticatedUserId()
  if (activeAuthenticatedUserId !== undefined && activeAuthenticatedUserId !== nextUserId) {
    arkmeComposerDraftStore.clearAccount(activeAuthenticatedUserId)
  }
  activeAuthenticatedUserId = nextUserId
})
