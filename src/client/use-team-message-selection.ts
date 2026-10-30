import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { TeamMessage } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { captureMessageDeletion, type MessageDeletionMotion } from './message-deletion-feedback.js'

export const teamMessageSelectable = (message: TeamMessage) => message.state === 'published' && message.contentStatus === 'available'

/** Selection is keyed by message identity, never by rotating authorization references. */
export function useTeamMessageSelection(input: {
  accountKey: string; messages: readonly TeamMessage[]; viewport: RefObject<HTMLElement>
  signal: AbortSignal; refresh(): Promise<unknown>; onChanged(): void
}) {
  const [ids, setIds] = useState<Set<string>>()
  const [confirm, setConfirm] = useState<TeamMessage[]>()
  const [removed, setRemoved] = useState(new Map<string, number>())
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('')
  const lock = useRef(false), motion = useRef<MessageDeletionMotion>()
  const current = useRef(input); current.current = input
  const keeps = (message: TeamMessage) => !removed.has(message.key) || message.contentStatus !== 'deleted' && message.version > removed.get(message.key)!
  const available = input.messages.filter(message => teamMessageSelectable(message) && keeps(message))
  const selected = available.filter(message => ids?.has(message.key))
  useEffect(() => {
    // Preserve selection identity while a change notification revalidates material.
    const keys = new Set(input.messages.filter(message => (teamMessageSelectable(message) || message.state === 'published' && message.contentStatus === 'revalidating') && keeps(message)).map(message => message.key))
    setIds(previous => previous && [...previous].some(key => !keys.has(key)) ? new Set([...previous].filter(key => keys.has(key))) : previous)
  }, [input.messages, removed])
  useEffect(() => {
    if (!ids || confirm) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="menu"], [aria-modal="true"], [data-arkme-note-detail]')) return
      event.preventDefault(); setIds(undefined)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [!!ids, !!confirm])
  useLayoutEffect(() => { motion.current?.afterRemoval() }, [removed])
  useEffect(() => () => motion.current?.cancel(), [])
  const enter = (keys: ReadonlySet<string>) => {
    if (lock.current) return
    const next = new Set(available.filter(message => keys.has(message.key)).map(message => message.key))
    if (next.size) { document.getSelection()?.removeAllRanges(); setIds(next) }
  }
  const toggle = (key: string) => {
    if (lock.current || !available.some(message => message.key === key)) return
    setIds(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  const ready = !!ids?.size && selected.length === ids.size
  const canDelete = ready && selected.length > 0 && selected.length <= 100 && selected.every(message => message.canDelete)
  const remove = async () => {
    if (lock.current || !confirm?.length) return
    // A refreshed version/permission must be reviewed again, not silently substituted.
    const messages = confirm.map(snapshot => current.current.messages.find(message => message.key === snapshot.key && message.version === snapshot.version && message.canDelete && teamMessageSelectable(message)))
    if (messages.some(message => !message)) { setError('消息或权限已更新，请重新选择后删除'); setConfirm(undefined); return }
    const batch = messages as TeamMessage[]
    const keys = new Set(batch.map(message => message.key))
    lock.current = true; setBusy(true); setError(''); setStatus('正在同步删除…'); setConfirm(undefined); setIds(undefined)
    motion.current?.cancel()
    if (input.viewport.current) motion.current = captureMessageDeletion(input.viewport.current, item => keys.has(item.itemUid))
    setRemoved(previous => new Map([...previous, ...batch.map(message => [message.key, message.version] as const)]))
    const failed: string[] = []
    let deleted = 0
    try {
      // Bound concurrency and retain per-message results; never call Chat with a Team reference.
      for (const message of batch) {
        if (input.signal.aborted) return
        try {
          await callArkme('team.app.delete', { messageRef: message.ref, version: message.version, expectedAccountKey: input.accountKey }, input.signal)
          deleted++
        } catch {
          if (input.signal.aborted) return
          failed.push(message.key)
          setRemoved(previous => { const next = new Map(previous); next.delete(message.key); return next })
        }
      }
      if (input.signal.aborted) return
      if (failed.length) {
        motion.current?.cancel()
        setStatus(deleted ? `已删除 ${deleted} 条，另 ${failed.length} 条未确认` : '删除结果尚未确认')
        setError('未确认的消息已恢复显示，请刷新核对后再操作')
        setIds(new Set(failed))
      } else setStatus(`已删除 ${deleted} 条消息`)
      await current.current.refresh()
      if (!input.signal.aborted) current.current.onChanged()
    } finally {
      lock.current = false
      if (!input.signal.aborted) setBusy(false)
    }
  }
  return { ids, selected, ready, available, keeps, busy, status, error, confirm, canDelete, enter, toggle, remove,
    exit: () => { if (!lock.current) setIds(undefined) },
    requestDelete: () => { if (!lock.current && canDelete) { setError(''); setConfirm([...selected]) } },
    closeConfirm: () => setConfirm(undefined), clearStatus: () => { setStatus(''); setError('') } }
}
