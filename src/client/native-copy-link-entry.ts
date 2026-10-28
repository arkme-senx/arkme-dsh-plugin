import type { NativeChatSelectionSnapshot } from '../native-chat-selection-contract.js'
import type { ArkmeMessageCopyLinkResult } from '../types.js'
import { isNativeForwardCaller } from './native-forward-entry.js'

export interface NativeCopyLinkAttempt { snapshot: NativeChatSelectionSnapshot; userId: number }
export interface NativeCopyLinkEntry { copy(attempt: NativeCopyLinkAttempt, signal: AbortSignal, caller: Window): Promise<void> }
export const NATIVE_COPY_LINK_ENTRY = '__arkmeNativeCopyLinkEntry'
export type NativeCopyLinkWindow = Window & { [NATIVE_COPY_LINK_ENTRY]?: NativeCopyLinkEntry }

/** Arkme owns generation and clipboard access; the native frame supplies only selection content. */
export function createNativeCopyLinkEntry(host: NativeCopyLinkWindow, dependencies: {
  isCurrentAccount(userId: number): boolean
  generate(attempt: NativeCopyLinkAttempt, signal: AbortSignal): Promise<ArkmeMessageCopyLinkResult>
  copyText(text: string, signal: AbortSignal): Promise<void>
}): NativeCopyLinkEntry {
  const results = new WeakMap<NativeCopyLinkAttempt, ArkmeMessageCopyLinkResult>()
  let busy = false
  const entry: NativeCopyLinkEntry = {
    async copy(attempt, signal, caller) {
      const check = () => {
        signal.throwIfAborted()
        if (host[NATIVE_COPY_LINK_ENTRY] !== entry || !isNativeForwardCaller(host, caller)) throw new Error('DSH 对话已切换，请重新选择')
        if (!dependencies.isCurrentAccount(attempt.userId)) throw new Error('账号已变化，请重新选择')
      }
      check()
      if (busy) throw new Error('正在复制链接，请稍候')
      busy = true
      try {
        let result = results.get(attempt)
        if (!result) {
          result = await waitForCopyOperation(dependencies.generate({ snapshot: structuredClone(attempt.snapshot), userId: attempt.userId }, signal), signal)
          check()
          results.set(attempt, result)
        }
        check()
        await waitForCopyOperation(dependencies.copyText(result.url, signal), signal)
        check()
      } finally { busy = false }
    },
  }
  return entry
}

export function copyNativeLink(doc: Document, attempt: NativeCopyLinkAttempt, signal: AbortSignal): Promise<void> {
  const caller = doc.defaultView
  const entry = (caller?.parent as NativeCopyLinkWindow | undefined)?.[NATIVE_COPY_LINK_ENTRY]
  if (!caller || caller.parent === caller || !entry) throw new Error('Arkme 复制链接尚未就绪，请稍后重试')
  return entry.copy(attempt, signal, caller)
}

// Clipboard APIs do not accept AbortSignal; cancellation must still release the UI wait.
function waitForCopyOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
