import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  ArkmeMessageCopyLinkResult,
  ArkmeSourceItem,
  ArkmeSourceList,
  ArkmeSourceSendResult,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

export interface ArkmeMessageActionViewItem {
  id: string
  actionRef: string
  conversationRef: string
  copyText: string
  copyLinkAvailable: boolean
  forwardAvailable: boolean
}

export function arkmeMessageActionConversationRef(
  items: readonly ArkmeMessageActionViewItem[],
): string | undefined {
  const references = new Set(items.map(item => item.conversationRef.trim()).filter(value => value !== ''))
  return references.size === 1 ? [...references][0] : undefined
}

export interface ArkmeMessageActionRequestIdentityState {
  selectionKey: string
  ids: Record<string, { requestId: string; recordUid: string; commentRecordUid: string; sendAtMillis: number }>
}

export function arkmeMessageActionSelection(
  items: readonly ArkmeMessageActionViewItem[],
  selectedIds: ReadonlySet<string>,
): ArkmeMessageActionViewItem[] {
  return items.filter(item => selectedIds.has(item.id) && item.actionRef.trim() !== '')
}

export function arkmeToggleMessageActionSelection(
  selectedIds: ReadonlySet<string>,
  itemId: string,
  limit = 100,
): Set<string> | undefined {
  const next = new Set(selectedIds)
  if (next.has(itemId)) next.delete(itemId)
  else if (next.size < limit) next.add(itemId)
  if (next.size === 0) return undefined
  return next
}

export function arkmeMessageActionCopyText(item: ArkmeMessageActionViewItem): string {
  return item.copyText.trim()
}

export function arkmeMessageActionStableRequestIds(
  current: ArkmeMessageActionRequestIdentityState | undefined,
  selectionKey: string,
  targetSourceRefs: readonly string[],
): ArkmeMessageActionRequestIdentityState {
  if (current?.selectionKey === selectionKey) {
    const ids = { ...current.ids }
    for (const target of targetSourceRefs) ids[target] ??= {
      requestId: crypto.randomUUID(),
      recordUid: crypto.randomUUID(),
      commentRecordUid: crypto.randomUUID(),
      sendAtMillis: Date.now(),
    }
    return { selectionKey, ids }
  }
  return {
    selectionKey,
    ids: Object.fromEntries(targetSourceRefs.map(target => [target, {
      requestId: crypto.randomUUID(),
      recordUid: crypto.randomUUID(),
      commentRecordUid: crypto.randomUUID(),
      sendAtMillis: Date.now(),
    }])),
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

async function copyText(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Embedded WebViews may expose Clipboard but deny it; match the normal
      // conversation surface by falling back to the selected textarea path.
    }
  }
  if (typeof document === 'undefined') throw new Error('复制失败，请稍后重试')
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  const selection = document.getSelection()
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  selection?.removeAllRanges()
  activeElement?.focus()
  if (!copied) throw new Error('复制失败，请稍后重试')
}

function targetMeta(source: ArkmeSourceItem): string {
  if (source.kind === 'private_chat') return '私聊'
  if (source.kind === 'group_chat') return '群聊'
  if (source.kind === 'topic') return '主题'
  return '发给自己'
}

function MessageActionIcon({ kind, size = 18 }: { kind: 'copy' | 'link' | 'select' | 'forward' | 'close'; size?: number }) {
  if (kind === 'copy') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden><rect x="6" y="6" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M14 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" stroke="currentColor" strokeWidth="1.5" /></svg>
  if (kind === 'link') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M13.1 10.9a5.75 5.75 0 0 1 0 8.1 5.75 5.75 0 0 1-8.1 0 5.75 5.75 0 0 1 0-8.1M10.6 13.4a5.75 5.75 0 0 1 0-8.1 5.75 5.75 0 0 1 8.1 0 5.75 5.75 0 0 1 0 8.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  if (kind === 'select') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden><path d="m2 4 1.3 1.3L6 2.7M9 4h9M2 10l1.3 1.3L6 8.7M9 10h9M2 16l1.3 1.3L6 14.7M9 16h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  if (kind === 'forward') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden><path d="m7.4 6.3 8.5-2.8c3.8-1.3 5.9.8 4.6 4.6l-2.8 8.5c-1.9 5.7-5 5.7-6.9 0L10 14.1l-2.6-.9c-5.7-1.9-5.7-5 0-6.9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="m10.1 13.7 3.6-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden><path d="m2 2 12 12M14 2 2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
}

const styles: Record<string, CSSProperties> = {
  menu: {
    position: 'fixed', zIndex: 1700, width: 178, padding: 6, boxSizing: 'border-box', borderRadius: 10,
    border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.menu,
    boxShadow: '0 14px 36px rgba(20,23,31,.16)',
  },
  menuButton: {
    width: '100%', minHeight: 34, display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 10px', boxSizing: 'border-box', border: 0, borderRadius: 8, background: 'transparent',
    color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 13, textAlign: 'left',
  },
  menuIcon: { width: 18, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: arkmeTheme.secondary },
  selectBar: {
    minHeight: 72, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(6px, 1.7vw, 18px)',
    padding: '7px clamp(8px, 3vw, 16px)', boxSizing: 'border-box', borderTop: `1px solid ${arkmeTheme.border}`,
    background: arkmeTheme.layer2,
  },
  selectButton: {
    width: 'clamp(44px, 6vw, 54px)', minWidth: 0, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
    padding: 0, border: 0, background: 'transparent', color: arkmeTheme.text,
    cursor: 'pointer', font: 'inherit', fontSize: 11,
  },
  icon: {
    width: 'clamp(30px, 3.8vw, 34px)', height: 'clamp(30px, 3.8vw, 34px)', display: 'grid', placeItems: 'center', borderRadius: 7,
    background: arkmeTheme.elevated, color: arkmeTheme.text,
  },
  closeButton: { width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, background: 'transparent', color: arkmeTheme.text, cursor: 'pointer' },
  status: {
    position: 'fixed', left: '50%', bottom: 102, zIndex: 1800, transform: 'translateX(-50%)',
    padding: '8px 12px', borderRadius: 9, background: 'rgba(23,25,28,.9)', color: '#fff',
    fontSize: 12, lineHeight: '18px', pointerEvents: 'none',
  },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1750, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 18, boxSizing: 'border-box', background: 'rgba(23,25,28,.34)',
  },
  dialog: {
    width: 'min(520px, 100%)', maxHeight: 'min(680px, calc(100vh - 36px))', display: 'flex', flexDirection: 'column',
    borderRadius: 12, background: arkmeTheme.layer2, boxShadow: '0 20px 54px rgba(23,25,28,.22)', overflow: 'hidden',
  },
  dialogHeader: { display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: `1px solid ${arkmeTheme.border}` },
  dialogTitle: { flex: 1, margin: 0, fontSize: 17, lineHeight: '24px' },
  input: { margin: '12px 16px 4px', padding: '9px 11px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.input, color: arkmeTheme.text },
  targetList: { flex: 1, minHeight: 140, overflowY: 'auto', padding: '8px 12px' },
  target: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer' },
  targetCheck: { width: 20, height: 20, display: 'grid', placeItems: 'center', border: `1px solid ${arkmeTheme.border}`, borderRadius: 6 },
  dialogFooter: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: `1px solid ${arkmeTheme.border}` },
  dialogButton: { minWidth: 72, height: 34, padding: '0 14px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.elevated, color: arkmeTheme.text, cursor: 'pointer' },
  primary: { border: 0, background: arkmeTheme.accent, color: '#fff' },
  selectCheckButton: {
    width: 32, height: 32, flex: 'none', display: 'grid', placeItems: 'center', alignSelf: 'center',
    padding: 0, border: 0, borderRadius: 999, background: 'transparent', color: '#fff', cursor: 'pointer',
  },
  selectCheckCircle: {
    width: 22, height: 22, display: 'grid', placeItems: 'center', boxSizing: 'border-box',
    border: `1.5px solid ${arkmeTheme.tertiary}`, borderRadius: 999, background: 'transparent',
  },
}

const FORWARD_TARGET_LIMIT = 80
const MAX_FORWARD_TARGET_SELECTION = 5
const MESSAGE_ACTION_REQUEST_TIMEOUT_MS = 30_000
const MESSAGE_ACTION_MENU_OUTER_WIDTH = 178
const MESSAGE_ACTION_MENU_OUTER_HEIGHT = 4 * 34 + (6 + 1) * 2

export function ArkmeMessageActionSelectCheck({
  selected,
  onClick,
}: {
  selected: boolean
  onClick(event: ReactMouseEvent<HTMLButtonElement>): void
}) {
  return <button
    type="button"
    aria-label={selected ? '取消选择消息' : '选择消息'}
    style={styles.selectCheckButton}
    onClick={onClick}
  ><span style={{
    ...styles.selectCheckCircle,
    ...(selected ? { borderColor: '#07C160', background: '#07C160' } : {}),
  }}>{selected ? '✓' : ''}</span></button>
}

interface MenuState { itemId: string; left: number; top: number }
interface PickerState {
  itemIds: string[]
  loading: boolean
  submitted: boolean
  targets: ArkmeSourceItem[]
  selectedRefs: string[]
  keyword: string
  commentText: string
  error: string
}

export function useArkmeMessageActions(input: {
  scopeKey: string
  items: readonly ArkmeMessageActionViewItem[]
  onForwarded?: (target: ArkmeSourceItem, result: ArkmeSourceSendResult) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>()
  const [menu, setMenu] = useState<MenuState>()
  const [picker, setPicker] = useState<PickerState>()
  const [busy, setBusy] = useState<'copy-link' | 'forward'>()
  const [status, setStatus] = useState('')
  const revisionRef = useRef(0)
  const requestIdsRef = useRef<ArkmeMessageActionRequestIdentityState>()
  const selected = useMemo(() => selectedIds === undefined ? [] : arkmeMessageActionSelection(input.items, selectedIds), [input.items, selectedIds])

  const showStatus = useCallback((value: string, revision = revisionRef.current) => {
    if (revision !== revisionRef.current) return
    setStatus(value)
    window.setTimeout(() => {
      if (revision === revisionRef.current) setStatus(current => current === value ? '' : current)
    }, 2_800)
  }, [])

  useEffect(() => {
    revisionRef.current += 1
    setSelectedIds(undefined)
    setMenu(undefined)
    setPicker(undefined)
    setBusy(undefined)
    setStatus('')
    requestIdsRef.current = undefined
  }, [input.scopeKey])

  useEffect(() => {
    if (selectedIds === undefined) return
    const visible = new Set(arkmeMessageActionSelection(input.items, selectedIds).map(item => item.id))
    if (visible.size === 0) setSelectedIds(undefined)
    else if (visible.size !== selectedIds.size) setSelectedIds(visible)
  }, [input.items, selectedIds])

  useEffect(() => {
    if (menu === undefined) return
    const close = () => { setMenu(undefined) }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('resize', close) }
  }, [menu])

  const openMenu = useCallback((item: ArkmeMessageActionViewItem, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy !== undefined) return
    setMenu({
      itemId: item.id,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - MESSAGE_ACTION_MENU_OUTER_WIDTH - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - MESSAGE_ACTION_MENU_OUTER_HEIGHT - 8)),
    })
  }, [busy])

  const enter = useCallback((item: ArkmeMessageActionViewItem) => {
    if (item.actionRef.trim() === '' || busy !== undefined) return
    setMenu(undefined)
    setSelectedIds(new Set([item.id]))
  }, [busy])

  const toggle = useCallback((item: ArkmeMessageActionViewItem) => {
    if (item.actionRef.trim() === '' || busy !== undefined) return
    setSelectedIds(current => {
      const selectedItems = arkmeMessageActionSelection(input.items, current ?? new Set())
      if (!current?.has(item.id) && arkmeMessageActionConversationRef([...selectedItems, item]) === undefined) {
        showStatus('不能跨会话多选')
        return current
      }
      return arkmeToggleMessageActionSelection(current ?? new Set(), item.id)
    })
  }, [busy, input.items, showStatus])

  const copyOne = useCallback(async (item: ArkmeMessageActionViewItem) => {
    const revision = revisionRef.current
    setMenu(undefined)
    const value = arkmeMessageActionCopyText(item)
    if (value === '') { showStatus('当前消息没有可复制文本', revision); return }
    try { await copyText(value); showStatus('已复制', revision) }
    catch (error) { showStatus(errorMessage(error) || '复制失败，请稍后重试', revision) }
  }, [showStatus])

  const copyLink = useCallback(async (items: readonly ArkmeMessageActionViewItem[]) => {
    if (busy !== undefined || items.length === 0 || items.some(item => !item.copyLinkAvailable)) return
    const revision = revisionRef.current
    const conversationRef = arkmeMessageActionConversationRef(items)
    if (conversationRef === undefined) { showStatus('不能跨会话复制链接', revision); return }
    setMenu(undefined)
    setBusy('copy-link')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => { controller.abort() }, MESSAGE_ACTION_REQUEST_TIMEOUT_MS)
    try {
      const result = await callArkme<ArkmeMessageCopyLinkResult>('message-actions.copy-link', {
        conversationRef,
        actionRefs: items.map(item => item.actionRef),
      }, controller.signal)
      if (revision !== revisionRef.current) return
      await copyText(result.url)
      if (revision !== revisionRef.current) return
      setSelectedIds(undefined)
      showStatus('已复制链接')
    } catch (error) {
      if (revision === revisionRef.current) showStatus(controller.signal.aborted ? '复制链接超时，请重试' : errorMessage(error) || '分享失败，请重试')
    } finally {
      window.clearTimeout(timeout)
      if (revision === revisionRef.current) setBusy(undefined)
    }
  }, [busy, showStatus])

  const openForward = useCallback(async (items: readonly ArkmeMessageActionViewItem[]) => {
    const revision = revisionRef.current
    setMenu(undefined)
    if (items.length === 0 || items.some(item => !item.forwardAvailable)) { showStatus('所选消息暂不支持转发'); return }
    if (arkmeMessageActionConversationRef(items) === undefined) { showStatus('不能跨会话转发'); return }
    setPicker({ itemIds: items.map(item => item.id), loading: true, submitted: false, targets: [], selectedRefs: [], keyword: '', commentText: '', error: '' })
    const controller = new AbortController()
    const timeout = window.setTimeout(() => { controller.abort() }, MESSAGE_ACTION_REQUEST_TIMEOUT_MS)
    try {
      const [root, self] = await Promise.all([
        callArkme<ArkmeSourceList>('sources.list', { directory: 'root', limit: FORWARD_TARGET_LIMIT }, controller.signal),
        callArkme<ArkmeSourceList>('sources.list', { directory: 'send_to_self', limit: FORWARD_TARGET_LIMIT }, controller.signal).catch(() => ({ directory: 'send_to_self' as const, items: [], hasMore: false })),
      ])
      const byRef = new Map<string, ArkmeSourceItem>()
      for (const target of [...root.items, ...self.items]) {
        if (['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'].includes(target.kind)) byRef.set(target.sourceRef, target)
      }
      if (revision !== revisionRef.current) return
      setPicker(current => current === undefined ? current : { ...current, loading: false, targets: [...byRef.values()], error: byRef.size === 0 ? '暂无可转发对象' : '' })
    } catch (error) {
      if (revision !== revisionRef.current) return
      setPicker(current => current === undefined ? current : { ...current, loading: false, error: controller.signal.aborted ? '转发对象加载超时' : errorMessage(error) || '转发对象加载失败' })
    } finally {
      window.clearTimeout(timeout)
    }
  }, [showStatus])

  const confirmForward = useCallback(async () => {
    if (picker === undefined || busy !== undefined || picker.selectedRefs.length === 0) return
    const forwardedItems = input.items.filter(item => picker.itemIds.includes(item.id) && item.actionRef.trim() !== '')
    if (forwardedItems.length !== picker.itemIds.length || forwardedItems.some(item => !item.forwardAvailable)) {
      setPicker(current => current === undefined ? current : { ...current, error: '所选消息已变化，请退出后重新选择' })
      return
    }
    const revision = revisionRef.current
    const targets = picker.selectedRefs.map(ref => picker.targets.find(target => target.sourceRef === ref)).filter((target): target is ArkmeSourceItem => target !== undefined)
    const conversationRef = arkmeMessageActionConversationRef(forwardedItems)
    if (conversationRef === undefined) {
      setPicker(current => current === undefined ? current : { ...current, error: '不能跨会话转发' })
      return
    }
    const forwardSelectionKey = `${conversationRef}\u0000${forwardedItems.map(item => item.id).join(',')}`
    requestIdsRef.current = arkmeMessageActionStableRequestIds(requestIdsRef.current, forwardSelectionKey, targets.map(target => target.sourceRef))
    setBusy('forward')
    setPicker(current => current === undefined ? current : { ...current, submitted: true, error: '' })
    const controller = new AbortController()
    const timeout = window.setTimeout(() => { controller.abort() }, MESSAGE_ACTION_REQUEST_TIMEOUT_MS)
    const results = await Promise.allSettled(targets.map(async target => {
        const identity = requestIdsRef.current?.ids[target.sourceRef] ?? {
          requestId: crypto.randomUUID(),
          recordUid: crypto.randomUUID(),
          commentRecordUid: crypto.randomUUID(),
          sendAtMillis: Date.now(),
        }
        const result = await callArkme<ArkmeSourceSendResult>('message-actions.forward', {
          conversationRef,
          targetSourceRef: target.sourceRef,
          actionRefs: forwardedItems.map(item => item.actionRef),
          requestId: `arkme-forward-${identity.requestId}`,
          recordUid: identity.recordUid,
          commentRecordUid: identity.commentRecordUid,
          sendAtMillis: identity.sendAtMillis,
          ...(picker.commentText.trim() === '' ? {} : { commentText: picker.commentText.trim() }),
        }, controller.signal)
        return { target, result }
      }))
    window.clearTimeout(timeout)
    if (revision !== revisionRef.current) return
    const successes = results.filter((result): result is PromiseFulfilledResult<{ target: ArkmeSourceItem; result: ArkmeSourceSendResult }> => result.status === 'fulfilled')
    const failures = results.length - successes.length
    const warningRefs = successes
      .filter(success => (success.value.result.warningText ?? '').trim() !== '')
      .map(success => success.value.target.sourceRef)
    const warningText = successes
      .map(success => success.value.result.warningText?.trim() ?? '')
      .find(value => value !== '') ?? '转发已完成，附言发送失败'
    for (const success of successes) input.onForwarded?.(success.value.target, success.value.result)
    if (successes.length === 0) {
      const message = controller.signal.aborted ? '转发超时，请重试' : errorMessage((results[0] as PromiseRejectedResult | undefined)?.reason) || '发送失败，请重试'
      setPicker(current => current === undefined ? current : { ...current, error: message })
      showStatus(message)
      setBusy(undefined)
      return
    }
    if (failures > 0) {
      const failedRefs = targets
        .filter((target, index) => results[index]?.status === 'rejected' || warningRefs.includes(target.sourceRef))
        .map(target => target.sourceRef)
      setPicker(current => current === undefined ? current : {
        ...current,
        selectedRefs: failedRefs,
        error: `已转发 ${String(successes.length)} 个目标，${String(failures)} 个失败，可重试`,
      })
      setBusy(undefined)
      showStatus(`已转发 ${String(successes.length)} 个目标，${String(failures)} 个失败`)
      return
    }
    if (warningRefs.length > 0) {
      setPicker(current => current === undefined ? current : {
        ...current,
        selectedRefs: warningRefs,
        error: warningText,
      })
      setBusy(undefined)
      showStatus(warningText)
      return
    }
    setPicker(undefined)
    setSelectedIds(undefined)
    requestIdsRef.current = undefined
    setBusy(undefined)
    showStatus(`已转发到 ${String(successes.length)} 个目标`)
  }, [busy, input, picker, showStatus])

  const menuItem = menu === undefined ? undefined : input.items.find(item => item.id === menu.itemId)
  const filteredTargets = picker === undefined ? [] : picker.targets.filter(target => {
    const keyword = picker.keyword.trim().toLowerCase()
    return keyword === '' || `${target.displayName} ${targetMeta(target)}`.toLowerCase().includes(keyword)
  })

  const overlay = <>
    {menu !== undefined && menuItem !== undefined && <div style={{ ...styles.menu, left: menu.left, top: menu.top }} onMouseDown={event => { event.stopPropagation() }} role="menu" aria-label="消息操作">
      <button type="button" role="menuitem" aria-label="复制" style={styles.menuButton} onClick={() => { void copyOne(menuItem) }}><span style={styles.menuIcon}><MessageActionIcon kind="copy" size={16} /></span><span>复制</span></button>
      <button type="button" role="menuitem" aria-label="复制链接" style={{ ...styles.menuButton, opacity: menuItem.copyLinkAvailable ? 1 : .4 }} disabled={!menuItem.copyLinkAvailable} onClick={() => { void copyLink([menuItem]) }}><span style={styles.menuIcon}><MessageActionIcon kind="link" size={16} /></span><span>复制链接</span></button>
      <button type="button" role="menuitem" aria-label="多选" style={styles.menuButton} onClick={() => { enter(menuItem) }}><span style={styles.menuIcon}><MessageActionIcon kind="select" size={16} /></span><span>多选</span></button>
      <button type="button" role="menuitem" aria-label="转发" style={{ ...styles.menuButton, opacity: menuItem.forwardAvailable ? 1 : .4 }} disabled={!menuItem.forwardAvailable} onClick={() => { void openForward([menuItem]) }}><span style={styles.menuIcon}><MessageActionIcon kind="forward" size={18} /></span><span>转发</span></button>
    </div>}
    {status !== '' && <div style={styles.status} role="status">{status}</div>}
    {picker !== undefined && <div style={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && busy !== 'forward') setPicker(undefined) }}>
      <section style={styles.dialog} role="dialog" aria-modal="true" aria-label="选择转发对象">
        <header style={styles.dialogHeader}><h3 style={styles.dialogTitle}>转发给</h3><button type="button" aria-label="关闭转发对象选择" style={styles.closeButton} disabled={busy === 'forward'} onClick={() => { setPicker(undefined) }}><MessageActionIcon kind="close" size={16} /></button></header>
        <input style={styles.input} value={picker.keyword} placeholder="搜索" aria-label="搜索转发对象" disabled={busy === 'forward'} onChange={event => { setPicker({ ...picker, keyword: event.target.value }) }} />
        <div style={styles.targetList}>
          {picker.loading ? <div>正在加载…</div> : filteredTargets.map(target => {
            const selectedTarget = picker.selectedRefs.includes(target.sourceRef)
            return <button key={target.sourceRef} type="button" style={styles.target} disabled={busy === 'forward'} onClick={() => {
              if (busy === 'forward') return
              if (!selectedTarget && picker.selectedRefs.length >= MAX_FORWARD_TARGET_SELECTION) {
                showStatus(`最多选择 ${String(MAX_FORWARD_TARGET_SELECTION)} 个转发对象`)
                return
              }
              const refs = selectedTarget ? picker.selectedRefs.filter(ref => ref !== target.sourceRef) : [...picker.selectedRefs, target.sourceRef]
              setPicker({ ...picker, selectedRefs: refs, error: '' })
            }}><span style={{ ...styles.targetCheck, background: selectedTarget ? arkmeTheme.accent : 'transparent', color: selectedTarget ? '#fff' : arkmeTheme.text }}>{selectedTarget ? '✓' : ''}</span><span style={{ flex: 1 }}><strong>{target.displayName}</strong><small style={{ display: 'block', color: arkmeTheme.secondary }}>{targetMeta(target)}</small></span></button>
          })}
          {picker.error !== '' && <div style={{ color: arkmeTheme.danger, padding: 8 }}>{picker.error}</div>}
        </div>
        <textarea style={{ ...styles.input, minHeight: 58, resize: 'vertical' }} value={picker.commentText} placeholder="附言（可选）" disabled={busy === 'forward' || picker.submitted} onChange={event => { setPicker({ ...picker, commentText: event.target.value }) }} />
        <footer style={styles.dialogFooter}><button type="button" style={styles.dialogButton} disabled={busy === 'forward'} onClick={() => { setPicker(undefined) }}>取消</button><button type="button" style={{ ...styles.dialogButton, ...styles.primary, opacity: picker.selectedRefs.length === 0 || busy === 'forward' ? .45 : 1 }} disabled={picker.selectedRefs.length === 0 || busy === 'forward'} onClick={() => { void confirmForward() }}>{busy === 'forward' ? '转发中…' : '转发'}</button></footer>
      </section>
    </div>}
  </>

  const selectionBar = selectedIds === undefined ? undefined : <div style={styles.selectBar} role="toolbar" aria-label={`已选择 ${String(selected.length)} 条消息`}>
    <button type="button" aria-label="复制文本" style={{ ...styles.selectButton, opacity: selected.length === 1 && busy === undefined ? 1 : .38 }} disabled={selected.length !== 1 || busy !== undefined} onClick={() => { const first = selected[0]; if (first !== undefined) void copyOne(first) }}><span style={styles.icon}><MessageActionIcon kind="copy" size={22} /></span><span>复制文本</span></button>
    <button type="button" aria-label="复制链接" style={{ ...styles.selectButton, opacity: selected.length > 0 && selected.every(item => item.copyLinkAvailable) && busy === undefined ? 1 : .38 }} disabled={selected.length === 0 || selected.some(item => !item.copyLinkAvailable) || busy !== undefined} onClick={() => { void copyLink(selected) }}><span style={styles.icon}><MessageActionIcon kind="link" size={22} /></span><span>复制链接</span></button>
    <button type="button" aria-label="转发" style={{ ...styles.selectButton, opacity: selected.length > 0 && selected.every(item => item.forwardAvailable) && busy === undefined ? 1 : .38 }} disabled={selected.length === 0 || selected.some(item => !item.forwardAvailable) || busy !== undefined} onClick={() => { void openForward(selected) }}><span style={styles.icon}><MessageActionIcon kind="forward" size={22} /></span><span>{busy === 'forward' ? '转发中' : '转发'}</span></button>
    <button type="button" style={{ ...styles.closeButton, opacity: busy === undefined ? 1 : .38 }} disabled={busy !== undefined} onClick={() => { setSelectedIds(undefined); requestIdsRef.current = undefined }} aria-label="退出多选"><MessageActionIcon kind="close" size={20} /></button>
  </div>

  return { selecting: selectedIds !== undefined, selectedIds: selectedIds ?? new Set<string>(), openMenu, toggle, overlay, selectionBar }
}
