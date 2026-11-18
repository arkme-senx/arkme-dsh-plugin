import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingTranscriptContext, ArkmeRecordingTranscriptLocation, ArkmeRecordingWorkbenchItem, ArkmeRecordingWindow } from '../../types.js'
import { ArkmeClientError, callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'

export type RecordingContextDirection = 'before' | 'after'
type EdgeStatus = 'idle' | 'loading' | 'done' | 'error' | 'changed'
type Edge = { boundary: number; span: number; status: EdgeStatus }
type ContextRead = {
  seed: ArkmeRecordingTranscriptLocation
  controller: AbortController
  dateStamp: number
  dayWindow: ArkmeRecordingWindow | undefined
  start: number
  end: number
  items: ArkmeRecordingWorkbenchItem[]
  revisions: Map<string, string>
  before: Edge
  after: Edge
}

const INITIAL_SPAN = 60_000
const MAX_SPAN = 3_600_000
const MAX_ATTEMPTS = 8

/** Each side owns a non-overlapping continuation and at most one active load. */
export function useRecordingTranscriptContext(seed: ArkmeRecordingTranscriptLocation | undefined, dateStamp: number,
  beforePublish: () => void, dayWindow?: ArkmeRecordingWindow) {
  const current = useRef<ContextRead>()
  const live = useRef({ seed, beforePublish })
  live.current = { seed, beforePublish }
  const [snapshot, setSnapshot] = useState<{ seed: ArkmeRecordingTranscriptLocation; items: ArkmeRecordingWorkbenchItem[];
    before: EdgeStatus; after: EdgeStatus }>()

  const load = useCallback(async (direction: RecordingContextDirection, retry = false) => {
    const read = current.current
    if (!read || live.current.seed !== read.seed) return
    const edge = read[direction]
    if (edge.status === 'loading' || edge.status === 'done' || edge.status === 'changed' || edge.status === 'error' && !retry) return
    const earlier = direction === 'before'
    const atEnd = () => earlier ? edge.boundary <= read.start : edge.boundary >= read.end
    const publish = () => {
      if (read.controller.signal.aborted || live.current.seed !== read.seed) return
      setSnapshot({ seed: read.seed, items: read.items, before: read.before.status, after: read.after.status })
    }
    edge.status = 'loading'
    publish()
    try {
      await withArkmeReadDeadline(async signal => {
        for (let attempt = 0; attempt < MAX_ATTEMPTS && !atEnd(); attempt++) {
          const startAtMillis = earlier ? Math.max(read.start, edge.boundary - edge.span) : edge.boundary
          const endAtMillis = earlier ? edge.boundary : Math.min(read.end, edge.boundary + edge.span)
          let page: ArkmeRecordingTranscriptContext
          try {
            page = await callArkme<ArkmeRecordingTranscriptContext>('recordings.transcript.context', {
              dateStamp: read.dateStamp, startAtMillis, endAtMillis, ...(read.dayWindow ? { window: read.dayWindow } : {}),
            }, signal)
          } catch (error) {
            if (error instanceof ArkmeClientError && error.body.code === 'recording-location-range-too-dense' && endAtMillis - startAtMillis > 1) {
              edge.span = Math.max(1, Math.floor((endAtMillis - startAtMillis) / 3)); continue
            }
            throw error
          }
          signal.throwIfAborted()
          if (live.current.seed !== read.seed) return
          if (!Array.isArray(page.items) || page.items.length > 200 || page.items.some((item, index) =>
            !Number.isSafeInteger(item.startAtMillis) || item.startAtMillis < startAtMillis || item.startAtMillis >= endAtMillis
            || index > 0 && item.startAtMillis < page.items[index - 1]!.startAtMillis)) throw new Error('无效的转写上下文')
          const revisions = Object.entries(page.revisions ?? {})
          if (revisions.some(([key, version]) => read.revisions.has(key) && read.revisions.get(key) !== version)) {
            edge.status = 'changed'; return
          }
          edge.boundary = earlier ? startAtMillis : endAtMillis
          if (page.items.length === 0) {
            // Skip quiet intervals without reading the full day or requesting a
            // separate page for every minute of silence.
            edge.span = Math.min(MAX_SPAN, edge.span * 4); continue
          }
          const byId = new Map(read.items.map(item => [item.itemId, item]))
          const incoming = new Set(page.items.map(item => item.itemId))
          const newRows = page.items.some(item => !byId.has(item.itemId))
          for (const [key, version] of revisions) read.revisions.set(key, version)
          if (!newRows) continue
          const remaining = read.items.filter(item => !incoming.has(item.itemId))
          const ordered = page.items.map(item => byId.get(item.itemId) ?? item)
          live.current.beforePublish()
          read.items = (earlier ? [...ordered, ...remaining] : [...remaining, ...ordered]).sort((a, b) => a.startAtMillis - b.startAtMillis)
          edge.span = INITIAL_SPAN
          return
        }
      }, read.controller.signal)
      if (edge.status === 'loading') edge.status = atEnd() ? 'done' : 'idle'
    } catch (error) {
      edge.status = error instanceof ArkmeClientError && error.body.code === 'recording-view-changed' ? 'changed' : 'error'
    }
    publish()
  }, [])

  useEffect(() => {
    if (!seed?.items.length || typeof window === 'undefined') return
    const end = new Date(dateStamp)
    end.setDate(end.getDate() + 1)
    const start = Math.max(0, dayWindow?.dateStamp ?? dateStamp), stop = dayWindow?.endStamp ?? end.getTime()
    const controller = new AbortController()
    // Include all rows sharing the seed edge's millisecond on the first read.
    const before = Math.min(stop, seed.items[0]!.startAtMillis + 1)
    const after = Math.max(start, seed.items.at(-1)!.startAtMillis)
    current.current = { seed, controller, dateStamp, dayWindow, start, end: stop, items: seed.items, revisions: new Map(Object.entries(seed.revisions ?? {})),
      before: { boundary: before, span: INITIAL_SPAN, status: before > start ? 'idle' : 'done' },
      after: { boundary: after, span: INITIAL_SPAN, status: after < stop ? 'idle' : 'done' } }
    void load('before')
    void load('after')
    return () => { controller.abort(); current.current = undefined }
  }, [seed, dateStamp, load, dayWindow])

  const value = snapshot?.seed === seed ? snapshot : undefined
  return { items: value?.items ?? seed?.items, before: value?.before ?? 'idle', after: value?.after ?? 'idle', load }
}
