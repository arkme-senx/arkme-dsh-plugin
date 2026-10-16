import { ArkmeClientError } from '../sdk/index.js'
import { arkmeAuthStore } from './auth-store.js'
import { tr } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { socialAccessStore } from './social-access-store.js'

type BindingPrompt = { accountKey: string; action: string }
let prompt: BindingPrompt | undefined
const listeners = new Set<() => void>()
function publish(value: BindingPrompt | undefined) {
  prompt = value
  for (const listener of listeners) listener()
}
export const socialBindingPrompt = {
  getSnapshot: () => prompt,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  close() { publish(undefined) },
}
const account = () => {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}

/** UI feedback at the explicit write boundary; never gate navigation or reads.
 * Server authorization remains owned by the existing business endpoints. */
export async function requirePhoneForSocialAction(action: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const accountKey = account()
  if (accountKey === undefined) return // Preserve the existing login flow.
  const controller = new AbortController()
  const stop = arkmeAuthStore.subscribe(() => { if (account() !== accountKey) controller.abort() })
  const requestSignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
  try {
    socialAccessStore.activate(accountKey)
    socialAccessStore.syncStoredConfirmation()
    // A known state is immediate UI feedback. Its refresh is independent of this
    // write; final authorization remains with the existing business endpoint.
    const refresh = socialAccessStore.refreshIfStale()
    if (socialAccessStore.getSnapshot().allowed === null) {
      await withArkmeReadDeadline(() => refresh, requestSignal)
      // Hydration may have supplied a stale local profile. Refresh it off-path.
      void socialAccessStore.refreshIfStale()
    }
    requestSignal.throwIfAborted()
    const snapshot = socialAccessStore.getSnapshot()
    if (account() !== accountKey || snapshot.accountKey !== accountKey || snapshot.allowed === null) {
      throw new Error(tr('暂时无法确认手机号绑定状态，请稍后重试'))
    }
    if (snapshot.allowed) return
    publish({ accountKey, action })
    throw new ArkmeClientError({ code: 'social-phone-binding-required', message: tr('绑定手机号后即可{v0}，你仍可继续浏览', { v0: tr(action) }), retryable: false })
  } finally { stop() }
}

export function isSocialBindingRequired(error: unknown): boolean {
  return (error as { body?: { code?: string } } | null)?.body?.code === 'social-phone-binding-required'
}
