import { arkmeAuthStore } from './auth-store.js'

type Request = { accountScope: string; url: string }
let request: Request | undefined
const listeners = new Set<() => void>()
export function identityShareAccountScope(): string {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
}
export const identityShareUi = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot: () => request,
  open(accountScope: string, url: string) {
    if (!accountScope || accountScope !== identityShareAccountScope()) return
    request = { accountScope, url }; listeners.forEach(listener => listener())
  },
  close() { request = undefined; listeners.forEach(listener => listener()) },
}
