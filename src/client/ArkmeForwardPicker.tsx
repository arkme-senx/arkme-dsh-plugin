import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ArkmeSourceItem, ArkmeSourceList, ArkmeSourceSendResult } from '../types.js'
import { arkmeSourceAllowsUserWrite } from '../topic-policy.js'
import { callArkme, ArkmeClientError } from './api.js'
import { ArkmeForwardDialog, ArkmeForwardTargetRow, arkmeForwardStyles as styles } from './ArkmeForwardDialog.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

export interface ForwardSourcePresentation {
  title: string
  subtitle?: string
  icon?: ReactNode
}

export interface ForwardRequestIdentity {
  requestId: string
  recordUid: string
  commentRecordUid: string
  sendAtMillis: number
}
export interface ArkmeForwardDelivery {
  send(target: ArkmeSourceItem, identity: ForwardRequestIdentity, comment: string, signal: AbortSignal): Promise<ArkmeSourceSendResult>
}

function errorMessage(error: unknown): string {
  return error instanceof ArkmeClientError ? error.body.message : error instanceof Error ? error.message : '转发失败，请重试'
}
function targetMeta(source: ArkmeSourceItem): string {
  return source.kind === 'private_chat' ? '私聊' : source.kind === 'group_chat' ? '群聊' : source.kind === 'topic' ? '主题' : '发给自己'
}
const targetKey = (target: ArkmeSourceItem) => `${target.kind}:${target.kind === 'send_to_self' || target.kind === 'default_category' ? target.kind : arkmeSourceIdentityKey(target)}`

type Directory = 'root' | 'send_to_self'
const DIRECTORIES: readonly Directory[] = ['root', 'send_to_self']
interface DirectoryPage { items: ArkmeSourceItem[]; loading: boolean; error: string; cursor: string | undefined }
const emptyPage = (): DirectoryPage => ({ items: [], loading: true, error: '', cursor: undefined })
const directoryLabel = (directory: Directory) => directory === 'root' ? '聊天对象' : '自己与主题'

/** Shared target UI. Source identity and delivery remain owned by the caller. */
export function ArkmeForwardPicker({ open = true, source, messageCount, delivery, onClose, onComplete, onStatus, onForwarded }: {
  open?: boolean
  source?: ForwardSourcePresentation
  messageCount?: number
  delivery: ArkmeForwardDelivery
  onClose(): void
  onComplete(): void
  onStatus(message: string): void
  onForwarded?: (target: ArkmeSourceItem, result: ArkmeSourceSendResult) => void
}) {
  const [pages, setPages] = useState<Record<Directory, DirectoryPage>>({ root: emptyPage(), send_to_self: emptyPage() })
  const targets = [...new Map(Object.values(pages).flatMap(page => page.items).map(target => [targetKey(target), target])).values()]
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [comment, setComment] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const dialog = useRef<HTMLElement>(null)
  const busy = useRef(false)
  const closed = useRef(false)
  const loadRequests = useRef<Partial<Record<Directory, AbortController>>>({})
  const sendRequest = useRef<AbortController>()
  const ids = useRef(new Map<string, ForwardRequestIdentity>())
  const completed = useRef(new Set<string>())
  const frozenComment = useRef<string>()

  const load = async (directory: Directory, more = false) => {
    if (busy.current) return
    loadRequests.current[directory]?.abort()
    const request = new AbortController(); loadRequests.current[directory] = request
    const cursor = more ? pages[directory].cursor : undefined
    const timeout = setTimeout(() => request.abort(), 30_000)
    setPages(current => ({ ...current, [directory]: { ...current[directory], loading: true, error: '' } }))
    try {
      const page = await callArkme<ArkmeSourceList>('sources.list', { directory, limit: 80, ...(cursor ? { cursor } : {}) }, request.signal)
      request.signal.throwIfAborted()
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw new Error('转发对象分页暂不可用，请重试')
      if (!closed.current && loadRequests.current[directory] === request) setPages(current => {
        const unique = new Map((more ? current[directory].items : []).map(target => [targetKey(target), target]))
        for (const target of page.items) {
          if (arkmeSourceAllowsUserWrite(target) && ['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'].includes(target.kind)) unique.set(targetKey(target), target)
        }
        return { ...current, [directory]: { items: [...unique.values()], loading: false, error: '', cursor: page.hasMore ? page.nextCursor : undefined } }
      })
    } catch (reason) {
      if (!closed.current && loadRequests.current[directory] === request) setPages(current => ({ ...current,
        [directory]: { ...current[directory], loading: false, error: request.signal.aborted ? '转发对象加载超时' : errorMessage(reason) },
      }))
    } finally { clearTimeout(timeout) }
  }
  useEffect(() => {
    if (!open) return
    closed.current = false
    const previous = dialog.current?.ownerDocument.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    // Keep already selected targets and their access refs when resuming the same attempt.
    for (const directory of DIRECTORIES) if (pages[directory].items.length === 0 || pages[directory].loading) void load(directory, Boolean(pages[directory].cursor))
    return () => {
      closed.current = true
      Object.values(loadRequests.current).forEach(request => request.abort())
      sendRequest.current?.abort()
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  const send = async () => {
    if (busy.current || selected.length === 0) return
    const pending = targets.filter(target => selected.includes(targetKey(target)) && !completed.current.has(targetKey(target)))
    if (pending.length === 0) return
    busy.current = true; setSending(true); setSubmitted(true); setError('')
    frozenComment.current ??= comment.trim()
    const request = new AbortController(); sendRequest.current = request
    const timeout = setTimeout(() => request.abort(), 30_000)
    try {
      const results = await Promise.allSettled(pending.map(async target => {
        const key = targetKey(target)
        let identity = ids.current.get(key)
        if (!identity) {
          identity = { requestId: crypto.randomUUID(), recordUid: crypto.randomUUID(), commentRecordUid: crypto.randomUUID(), sendAtMillis: Date.now() }
          ids.current.set(key, identity)
        }
        const result = await delivery.send(target, identity, frozenComment.current!, request.signal)
        if (result.localState !== 'synced' || !result.itemUid) throw new Error('转发结果未确认，请使用原请求重试')
        return result
      }))
      if (closed.current) return
      const failures: string[] = []; const warnings: string[] = []
      let successCount = 0
      results.forEach((result, index) => {
        const target = pending[index]!
        if (result.status === 'rejected') { failures.push(targetKey(target)); return }
        successCount++
        if (result.value.warningText?.trim()) warnings.push(targetKey(target))
        else completed.current.add(targetKey(target))
        try { onForwarded?.(target, result.value) } catch { /* A confirmed delivery is not retried for a projection callback. */ }
      })
      if (failures.length || warnings.length) {
        setSelected([...failures, ...warnings])
        const warning = results.find((r): r is PromiseFulfilledResult<ArkmeSourceSendResult> => r.status === 'fulfilled' && Boolean(r.value.warningText?.trim()))
        const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
        const message = failures.length ? successCount ? `已转发 ${successCount} 个目标，${failures.length} 个失败，可重试` : request.signal.aborted ? '转发超时，请使用原请求重试' : errorMessage(rejected?.reason) : warning?.value.warningText ?? '转发已完成，附言发送失败'
        setError(message)
        onStatus(failures.length && successCount ? `已转发 ${successCount} 个目标，${failures.length} 个失败` : message)
      } else {
        onStatus(`已转发到 ${completed.current.size} 个目标`)
        onComplete()
      }
    } finally {
      clearTimeout(timeout); busy.current = false
      if (!closed.current) setSending(false)
    }
  }
  if (!open) return null
  const close = () => { if (!busy.current) onClose() }
  const filtered = targets.filter(target => !keyword.trim() || `${target.displayName} ${targetMeta(target)}`.toLowerCase().includes(keyword.trim().toLowerCase()))
  return <div data-arkme-forward-picker="true" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? [])]
      const current = dialog.current?.ownerDocument.activeElement
      const first = controls[0]; const last = controls.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (current === first || !controls.includes(current as HTMLElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (current === last || !controls.includes(current as HTMLElement))) { event.preventDefault(); first.focus() }
    }
  }}>
    <ArkmeForwardDialog dialogRef={dialog} viewport keyword={keyword} onKeywordChange={setKeyword} sending={sending}
      selectedTargets={targets.filter(target => selected.includes(targetKey(target)))}
      previewIcon={source?.icon} previewTitle={source?.title ?? '聊天记录'}
      previewSubtitle={source?.subtitle ?? (messageCount === undefined ? '聊天记录' : `${messageCount} 条消息`)}
      comment={comment} onCommentChange={setComment} commentDisabled={submitted} error={error}
      onClose={close} onSend={() => { void send() }}>
      <ul style={styles.forwardTargetList} aria-label="转发对象列表">
        {[...filtered.filter(target => target.kind === 'send_to_self'), ...filtered.filter(target => target.kind !== 'send_to_self')].map(target => {
          const key = targetKey(target); const checked = selected.includes(key)
          return <li key={key}><ArkmeForwardTargetRow target={target} selected={checked}
            disabled={sending || completed.current.has(key)} meta={targetMeta(target)}
            {...(completed.current.has(key) ? { statusText: '已转发' } : {})} onToggle={() => {
              if (busy.current || completed.current.has(key)) return
              if (!checked && selected.length >= 5) { onStatus('最多选择 5 个转发对象'); return }
              setSelected(checked ? selected.filter(value => value !== key) : [...selected, key]); setError('')
            }} /></li>
        })}
      </ul>
        {DIRECTORIES.map(directory => <div key={directory}>
          {pages[directory].loading && <div>{directoryLabel(directory)}正在加载…</div>}
          {pages[directory].error && <div role="alert">{directoryLabel(directory)}：{pages[directory].error}<button type="button" disabled={sending} onClick={() => { void load(directory, Boolean(pages[directory].cursor)) }}>重新加载</button></div>}
          {!pages[directory].loading && !pages[directory].error && pages[directory].cursor && <button type="button" disabled={sending} onClick={() => { void load(directory, true) }}>加载更多{directoryLabel(directory)}</button>}
        </div>)}
        {!Object.values(pages).some(page => page.loading || page.error) && filtered.length === 0 && <div>{keyword.trim() ? '已加载对象中没有匹配结果' : '暂无可转发对象'}</div>}
    </ArkmeForwardDialog>
  </div>
}
