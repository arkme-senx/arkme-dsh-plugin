import type { ArkmeUserProfileSnapshot } from '../types.js'
import { ArkmeClientError } from '../sdk/index.js'
import { arkmeAuthStore } from './auth-store.js'
import { callArkme } from './api.js'
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
  const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000), ...(signal ? [signal] : [])])
  try {
    // Display caches never authorize a write. Recheck both binding and unbinding on other devices.
    const snapshot = await withArkmeReadDeadline(readSignal => callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, readSignal), requestSignal)
    requestSignal.throwIfAborted()
    if (account() !== accountKey || !snapshot.profile || !accountKey.endsWith(`:${snapshot.profile.userId}`)) {
      throw new Error(tr('暂时无法确认手机号绑定状态，请稍后重试'))
    }
    const allowed = !!snapshot.profile.contact.phoneMasked?.trim()
    socialAccessStore.confirm(accountKey, allowed)
    if (allowed) return
    publish({ accountKey, action })
    throw new ArkmeClientError({ code: 'social-phone-binding-required', message: tr('绑定手机号后即可{v0}，你仍可继续浏览', { v0: tr(action) }), retryable: false })
  } finally { stop() }
}
