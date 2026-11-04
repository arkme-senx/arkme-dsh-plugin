import { useEffect, useRef, useState } from 'react'
import type { ArkmeArrangementItem, ArkmeArrangementMutationResult, ArkmeArrangementReminderToggleResult } from '../types.js'
import { callArkme } from './api.js'
import { moveArrangement, type ArrangementColumn } from './arrangement-board-model.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr } from './locale.js'

type Target = Pick<ArkmeArrangementItem, 'arrangementRef' | 'status'>
type Notice = { text: string; error?: boolean; undo?: { item: ArkmeArrangementItem; status: ArrangementColumn } }

/** Reuse owner commands and their reconciliation; never retry an uncertain write automatically. */
export function useRelatedArrangementActions(active: boolean, apply: (item: ArkmeArrangementItem) => void, remove: (ref: string) => void) {
  const [pending, setPending] = useState(''), [notice, setNotice] = useState<Notice>()
  const lifetime = useRef<AbortController>(), writing = useRef(false)
  const latest = useRef({ apply, remove }); latest.current = { apply, remove }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    setPending(''); if (!active) setNotice(undefined)
    return () => { controller.abort(); writing.current = false }
  }, [active])
  async function run(ref: string, work: (signal: AbortSignal) => Promise<void>) {
    const signal = lifetime.current?.signal
    if (!active || !signal || signal.aborted || writing.current) return false
    writing.current = true; setPending(ref); setNotice(undefined)
    try { await work(signal); return !signal.aborted }
    catch { if (!signal.aborted) setNotice({ text: tr('未能确认安排状态，请刷新后重试'), error: true }); return false }
    finally { if (!signal.aborted) { writing.current = false; setPending('') } }
  }
  async function read(ref: string, signal: AbortSignal) {
    const item = await withArkmeReadDeadline(s => callArkme<ArkmeArrangementItem>('arrangements.detail', { arrangementRef: ref }, s), signal)
    signal.throwIfAborted()
    if (item.arrangementRef !== ref || item.status === 'unknown') throw new Error('安排已变化，请刷新后操作')
    return item
  }
  const transition = (target: Target, status: ArrangementColumn, allowUndo: boolean) => run(target.arrangementRef, async signal => {
    const previous = await read(target.arrangementRef, signal)
    const result = await moveArrangement(previous, status, signal)
    signal.throwIfAborted(); latest.current.apply(result)
    setNotice({ text: tr(status === 'completed' ? '已完成' : '已恢复为未完成'),
      ...(allowUndo && previous.status !== status ? { undo: { item: result, status: previous.status as ArrangementColumn } } : {}) })
  })
  return {
    pending, notice, dismissNotice: () => setNotice(undefined),
    toggleComplete: (item: Target) => transition(item, item.status === 'completed' ? 'following' : 'completed', true),
    undo: () => notice?.undo ? transition(notice.undo.item, notice.undo.status, false) : Promise.resolve(false),
    deleteItem: (item: ArkmeArrangementItem) => run(item.arrangementRef, async signal => {
      const result = await callArkme<ArkmeArrangementMutationResult>('arrangements.mutate', { arrangementRef: item.arrangementRef, intent: 'delete' }, signal)
      signal.throwIfAborted()
      if (result.arrangementRef !== item.arrangementRef || result.deleted !== true) throw new Error('删除未确认')
      latest.current.remove(item.arrangementRef); setNotice({ text: tr('已移入已删除') })
    }),
    toggleReminder: (item: ArkmeArrangementItem) => run(item.arrangementRef, async signal => {
      const enabled = !item.reminderEnabled
      const result = await callArkme<ArkmeArrangementReminderToggleResult>('arrangements.reminder-enabled', { arrangementRef: item.arrangementRef, enabled }, signal)
      signal.throwIfAborted()
      if (result.item?.arrangementRef !== item.arrangementRef || result.item.reminderEnabled !== enabled) throw new Error('提醒未确认')
      latest.current.apply(result.item)
    }),
  }
}
