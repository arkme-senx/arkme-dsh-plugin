import { useEffect, useRef, useState } from 'react'
import type { ArkmeArrangementItem } from '../types.js'
import type {
  ArrangementOccurrenceResponse,
  ArrangementOccurrenceReview,
} from '../arrangement-occurrence.js'
import { callArkme } from './api.js'
import {
  OCCURRENCE_CHANGED,
  occurrenceChanged,
  occurrenceFailure,
} from './arrangement-occurrence-ui.js'
import { tr } from './locale.js'

function useOccurrenceLifetime() {
  const alive = useRef(true),
    pending = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return { alive, pending }
}

export function useOccurrenceReviewInbox(
  accountScope: string,
  onApplied?: (item: ArkmeArrangementItem) => void,
) {
  const [items, setItems] = useState<ArrangementOccurrenceReview[]>(),
    [selected, setSelected] = useState<Record<string, string>>({})
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0)
  const { alive, pending } = useOccurrenceLifetime()
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setSelected({})
    void (async () => {
      try {
        const result = await callArkme<ArrangementOccurrenceResponse>(
          'arrangements.occurrences.reviews.list',
          { expectedAccountScope: accountScope },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (result.accountScope !== accountScope) throw new Error(tr('账号已切换'))
        if (result.state !== 'ready' || !Array.isArray(result.items))
          throw new Error(result.reason ?? tr('待确认识别响应不完整，请重试'))
        setItems(result.items)
      } catch (error) {
        if (!controller.signal.aborted) setError(occurrenceFailure(error))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [accountScope, attempt])

  async function decide(
    review: ArrangementOccurrenceReview,
    action: 'merge' | 'create' | 'ignore',
  ) {
    const peer = review.peers.find((peer) => peer.arrangementRef === selected[review.id])
    if (pending.current || (action === 'merge' && !peer)) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await callArkme<ArrangementOccurrenceResponse>(
        'arrangements.occurrences.reviews.decide',
        {
          expectedAccountScope: accountScope,
          reviewId: review.id,
          action,
          ...(peer && action === 'merge'
            ? { targetRef: peer.arrangementRef, targetVersion: peer.version }
            : {}),
        },
      )
      if (!alive.current) return
      if (result.accountScope !== accountScope) throw new Error(tr('账号已切换'))
      if (result.state !== 'applied' || (action !== 'ignore' && !result.item)) {
        setSelected((selection) => {
          const next = { ...selection }
          delete next[review.id]
          return next
        })
        throw new Error(result.reason ?? tr('结果尚未确认，请刷新后重新选择'))
      }
      if (result.item) onApplied?.(result.item)
      setItems((rows) => rows?.filter((item) => item.id !== review.id))
      occurrenceChanged()
    } catch (error) {
      if (alive.current) setError(occurrenceFailure(error))
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return {
    items,
    selected,
    error,
    busy,
    loading,
    decide,
    select: (reviewId: string, ref: string) =>
      setSelected((selection) => ({ ...selection, [reviewId]: ref })),
    refresh: () => setAttempt((value) => value + 1),
  }
}

export function useOccurrenceHistoricalMerge(
  accountScope: string,
  item: ArkmeArrangementItem,
  routeKey: string,
  onApplied: (item: ArkmeArrangementItem) => void,
) {
  const [comparisonTrace, setComparisonTrace] = useState<ArrangementOccurrenceResponse['trace']>()
  const [open, setOpen] = useState(false),
    [review, setReview] = useState<ArrangementOccurrenceReview>(),
    [selected, setSelected] = useState(new Set<string>())
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const { alive, pending } = useOccurrenceLifetime()
  async function preview() {
    if (pending.current) return
    pending.current = true
    setOpen(true)
    setBusy(true)
    setError('')
    setReview(undefined)
    setComparisonTrace(undefined)
    setSelected(new Set())
    setNotice('')
    try {
      const result = await callArkme<ArrangementOccurrenceResponse>(
        'arrangements.occurrences.history.preview',
        {
          expectedAccountScope: accountScope,
          arrangementRef: item.arrangementRef,
          expectedRouteKey: routeKey,
        },
      )
      if (!alive.current) return
      if (result.accountScope !== accountScope) throw new Error(tr('账号已切换'))
      if (result.state !== 'preview' || !result.review)
        throw new Error(result.reason ?? tr('未能完成比对'))
      setReview(result.review)
      setComparisonTrace(result.trace)
    } catch (error) {
      if (alive.current) setError(occurrenceFailure(error))
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  async function apply() {
    if (pending.current || !review || !selected.size) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await callArkme<ArrangementOccurrenceResponse>(
        'arrangements.occurrences.history.apply',
        {
          expectedAccountScope: accountScope,
          arrangementRef: item.arrangementRef,
          reviewId: review.id,
          selectedRefs: [...selected],
        },
      )
      if (!alive.current) return
      if (result.accountScope !== accountScope) throw new Error(tr('账号已切换'))
      if (result.state !== 'applied' || !result.item)
        throw new Error(result.reason ?? tr('合并结果未确认，请刷新后重试'))
      onApplied(result.item)
      occurrenceChanged()
      setOpen(false)
      setReview(undefined)
      setNotice(tr('已归并，主安排字段保持原样，来源已追加'))
    } catch (error) {
      if (alive.current) setError(occurrenceFailure(error))
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return {
    open,
    review,
    selected,
    error,
    busy,
    notice,
    comparisonTrace,
    preview,
    apply,
    close: () => setOpen(false),
    toggle: (ref: string) =>
      setSelected((selected) => {
        const next = new Set(selected)
        if (next.has(ref)) next.delete(ref)
        else next.add(ref)
        return next
      }),
  }
}

export function useOccurrenceReviewCount(accountScope: string) {
  const [count, setCount] = useState<number>()
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const result = await callArkme<ArrangementOccurrenceResponse>(
          'arrangements.occurrences.reviews.summary',
          { expectedAccountScope: accountScope },
          controller.signal,
        )
        if (
          !controller.signal.aborted &&
          result.accountScope === accountScope &&
          result.state === 'ready'
        )
          setCount(result.count)
      } catch {
        if (!controller.signal.aborted) setCount(undefined)
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => {
        void refresh()
      }, 30000),
      focus = () => {
        void refresh()
      }
    window.addEventListener('focus', focus)
    window.addEventListener(OCCURRENCE_CHANGED, focus)
    return () => {
      controller.abort()
      clearInterval(timer)
      window.removeEventListener('focus', focus)
      window.removeEventListener(OCCURRENCE_CHANGED, focus)
    }
  }, [accountScope])
  return count
}
