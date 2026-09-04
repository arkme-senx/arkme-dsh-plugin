import { useCallback, useEffect, useRef } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeMessagePreparingReporter, type ArkmeMessagePreparingTransport } from './message-preparing-reporter.js'

const hostTransport: ArkmeMessagePreparingTransport = {
  report: async (target, prepareAtMillis) => {
    await callArkme('source.message-preparing.report', { sourceRef: target.sourceRef, prepareAtMillis }, AbortSignal.timeout(2000))
  },
  cancel: async (target, cancelAtMillis) => {
    await callArkme('source.message-preparing.cancel', { sourceRef: target.sourceRef, cancelAtMillis }, AbortSignal.timeout(2000))
  },
}

export function useMessagePreparing({ source, accountScope, enabled, focused, transport = hostTransport }: {
  source: ArkmeSourceItem | undefined
  accountScope: string | undefined
  enabled: boolean
  focused: boolean
  transport?: ArkmeMessagePreparingTransport
}) {
  const reporter = useRef<ArkmeMessagePreparingReporter>()
  const inputFocused = useRef(focused)
  const syncFocus = useCallback(() => {
    reporter.current?.setFocused(inputFocused.current
      && (typeof document === 'undefined' || (document.visibilityState !== 'hidden' && (document.hasFocus?.() ?? true))))
  }, [])

  useEffect(() => {
    const current = new ArkmeMessagePreparingReporter(transport)
    reporter.current = current
    const blur = () => { current.setFocused(false) }
    const pageHide = () => { current.stop() }
    const doc = typeof document === 'undefined' ? undefined : document
    const win = typeof window === 'undefined' ? undefined : window
    doc?.addEventListener('visibilitychange', syncFocus)
    win?.addEventListener('blur', blur)
    win?.addEventListener('focus', syncFocus)
    win?.addEventListener('pagehide', pageHide)
    return () => {
      doc?.removeEventListener('visibilitychange', syncFocus)
      win?.removeEventListener('blur', blur)
      win?.removeEventListener('focus', syncFocus)
      win?.removeEventListener('pagehide', pageHide)
      current.dispose()
      if (reporter.current === current) reporter.current = undefined
    }
  }, [transport, syncFocus])

  useEffect(() => {
    const isChat = source?.kind === 'private_chat' || source?.kind === 'group_chat'
    reporter.current?.setTarget(enabled && isChat && source.sourceKey !== undefined && accountScope !== undefined
      ? { sourceRef: source.sourceRef, sourceKey: source.sourceKey, accountScope } : undefined)
    inputFocused.current = focused
    syncFocus()
  }, [transport, enabled, focused, accountScope, source?.kind, source?.sourceKey, source?.sourceRef, syncFocus])

  const input = useCallback((text: string) => { reporter.current?.input(text) }, [])
  const stop = useCallback(() => { reporter.current?.stop() }, [])
  // DOM focus happens before React commits focused state, including menu insertions.
  const focus = useCallback((value: boolean) => { inputFocused.current = value; syncFocus() }, [syncFocus])
  return { input, stop, focus }
}
