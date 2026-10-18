import { useEffect, useState } from 'react'
import { callArkme } from './api.js'
import type { ArkmeQuoteReplyCapabilities } from '../message-quote.js'

export function useQuoteReplySupport(scope: string, sourceRef: string | undefined, enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ scope: string; ready: boolean; message: string; maxQuoteLength: number }>()
  useEffect(() => {
    if (!enabled || !sourceRef) { setState(undefined); return }
    const controller = new AbortController()
    setState({ scope, ready: false, message: '正在确认局部回复支持情况…', maxQuoteLength: 0 })
    void callArkme<ArkmeQuoteReplyCapabilities>('source.message-extension.capabilities', { sourceRef }, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ scope, ready: result.supported === true, maxQuoteLength: result.maxQuoteLength,
        message: result.supported === true ? '' : '局部回复尚待服务端接通，引用和正文会保留' })
    }, error => {
      if (!controller.signal.aborted) setState({ scope, ready: false, maxQuoteLength: 0, message: error instanceof Error ? error.message : '暂时无法确认局部回复支持情况，请重试' })
    })
    return () => controller.abort()
  }, [scope, sourceRef, enabled, attempt])
  return { ready: enabled && state?.scope === scope && state.ready,
    message: state?.scope === scope ? state.message : '正在确认局部回复支持情况…',
    maxQuoteLength: state?.scope === scope ? state.maxQuoteLength : 0,
    retry: () => setAttempt(value => value + 1) }
}
