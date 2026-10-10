import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  conversationVisibilityActivityAdvanced,
  type ConversationVisibilityActivityEvidence,
} from './conversation-directory-visibility-overlay.js'

export const CONVERSATION_REMOVAL_HOLD_MS = 700
export const CONVERSATION_REMOVAL_COLLAPSE_MS = 220
export type ConversationRemovalPhase = 'pending' | 'accepted' | 'collapsing'

interface Removal<Row> {
  key: string
  row: Row
  index: number
  activity: ConversationVisibilityActivityEvidence
  phase: ConversationRemovalPhase
  timer?: ReturnType<typeof setTimeout>
}

/** Presentation only: owner visibility is committed immediately, never by an animation timer. */
export function useConversationRemovalFeedback<Row>({ rows, rowKey, activity, scope, enabled }: {
  rows: readonly Row[]
  rowKey: (row: Row) => string
  activity: ReadonlyMap<string, ConversationVisibilityActivityEvidence>
  scope: string | undefined
  enabled: boolean
}) {
  const [, redraw] = useState(0)
  const bucket = useMemo(() => ({ entries: new Map<string, Removal<Row>>(), alive: true }), [scope, enabled])
  const current = useRef({ bucket, activity })
  current.current = { bucket, activity }
  const valid = (entry: Removal<Row>) => {
    const latest = current.current.activity.get(entry.key)
    return latest !== undefined && !conversationVisibilityActivityAdvanced(entry.activity, latest)
  }
  const owns = (entry: Removal<Row>) => bucket.alive && current.current.bucket === bucket
    && bucket.entries.get(entry.key) === entry
  const cancel = (entry: Removal<Row>) => {
    if (!owns(entry)) return
    clearTimeout(entry.timer)
    bucket.entries.delete(entry.key)
    redraw(value => value + 1)
  }
  useLayoutEffect(() => {
    bucket.alive = true
    return () => {
      bucket.alive = false
      for (const entry of bucket.entries.values()) clearTimeout(entry.timer)
      bucket.entries.clear()
    }
  }, [bucket])
  useLayoutEffect(() => {
    for (const entry of bucket.entries.values()) if (!valid(entry)) cancel(entry)
  }, [activity, bucket])

  // Filter during render as well: a returning conversation must never flash its stale snapshot.
  const retained = enabled && scope !== undefined ? [...bucket.entries.values()].filter(valid) : []
  const phases = new Map(retained.map(entry => [entry.key, entry.phase]))
  const presentedRows = rows.filter(row => !phases.has(rowKey(row)))
  for (const entry of retained.sort((left, right) => left.index - right.index)) {
    presentedRows.splice(Math.min(entry.index, presentedRows.length), 0, entry.row)
  }

  return {
    rows: presentedRows,
    phases,
    begin(row: Row, submittedActivity: ConversationVisibilityActivityEvidence) {
      if (!enabled || scope === undefined || !bucket.alive || current.current.bucket !== bucket) return undefined
      const key = rowKey(row)
      const previous = bucket.entries.get(key)
      if (previous !== undefined) cancel(previous)
      const entry: Removal<Row> = {
        key, row, activity: submittedActivity, phase: 'pending',
        index: Math.max(0, presentedRows.findIndex(item => rowKey(item) === key)),
      }
      bucket.entries.set(key, entry)
      redraw(value => value + 1)
      return entry
    },
    accept(entry: Removal<Row> | undefined) {
      if (entry === undefined || !owns(entry) || entry.phase !== 'pending') return
      if (!valid(entry)) { cancel(entry); return }
      entry.phase = 'accepted'
      redraw(value => value + 1)
      entry.timer = setTimeout(() => {
        if (!owns(entry)) return
        if (!valid(entry) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          cancel(entry)
          return
        }
        entry.phase = 'collapsing'
        redraw(value => value + 1)
        entry.timer = setTimeout(() => { cancel(entry) }, CONVERSATION_REMOVAL_COLLAPSE_MS)
      }, CONVERSATION_REMOVAL_HOLD_MS)
    },
    finishPending(entry: Removal<Row> | undefined) {
      if (entry?.phase === 'pending') cancel(entry)
    },
  }
}
