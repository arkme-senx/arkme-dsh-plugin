import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeMessageCopyLinkResult } from '../types.js'
import { ArkmePluginError, stringValue, type ServiceRuntime } from './service.js'

/** All sources enter Chat's existing permission, snapshot and content-audit pipeline. */
export async function createMessageCopyLink(runtime: ServiceRuntime, sources: readonly object[], session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeMessageCopyLinkResult> {
  signal?.throwIfAborted()
  const data = await runtime.authenticatedChatPost<Record<string, unknown>>(
    '/api/v1/chats/messages/copy-link/get-or-create', { sources }, session, signal,
  )
  const sid = stringValue(data.sid).trim(), url = stringValue(data.url).trim()
  if (sid === '' || !/^https?:\/\//i.test(url)) {
    throw new ArkmePluginError('message-copy-link-response-invalid', '复制链接失败，请稍后重试', true, 502)
  }
  return { sid, url }
}
