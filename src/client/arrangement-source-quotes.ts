import { useEffect, useRef, useState } from 'react'
import type { ArkmeArrangementEvidence, ArkmeArrangementSourceRead } from '../types.js'
import { callArkme } from './api.js'

type QuoteState = ArkmeArrangementSourceRead | { state: 'loading' } | { state: 'error'; message: string }

/** Protected quotes are scoped to the open detail; never persisted with the board cache. */
export function useArrangementSourceQuotes(arrangementRef: string, sources: ArkmeArrangementEvidence[], expanded: boolean) {
  const ids = JSON.stringify(sources.filter(source => source.readOnExpand).map(source => source.id))
  const scope = JSON.stringify([arrangementRef, ids])
  const [quotes, setQuotes] = useState<{ scope: string; values: Record<string, QuoteState> }>({ scope, values: {} })
  const active = useRef<AbortController>()

  async function read(evidenceId: string, signal: AbortSignal) {
    const update = (value: QuoteState) => {
      if (!signal.aborted) setQuotes(previous => previous.scope === scope
        ? { scope, values: { ...previous.values, [evidenceId]: value } } : previous)
    }
    update({ state: 'loading' })
    try {
      const value = await callArkme<ArkmeArrangementSourceRead>('arrangements.source.read', { arrangementRef, evidenceId }, signal)
      if (value.evidenceId !== evidenceId || !['ready', 'unavailable'].includes(value.state)) throw new Error('来源响应不一致，请重试')
      update(value)
    } catch (error) {
      update({ state: 'error', message: error instanceof Error ? error.message : '来源加载失败' })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    active.current = controller
    setQuotes({ scope, values: {} })
    if (expanded) {
      const pending: string[] = JSON.parse(ids)
      let cursor = 0
      const worker = async () => {
        while (!controller.signal.aborted && cursor < pending.length) {
          await read(pending[cursor++]!, controller.signal)
        }
      }
      // Expanding a multi-source arrangement must not flood the owner service.
      void worker()
      void worker()
    }
    return () => controller.abort()
  }, [scope, expanded])

  return {
    quote: (id: string): QuoteState => quotes.scope === scope ? quotes.values[id] ?? { state: 'loading' } : { state: 'loading' },
    retry: (id: string) => {
      const signal = active.current?.signal
      if (expanded && signal && !signal.aborted) void read(id, signal)
    },
  }
}
