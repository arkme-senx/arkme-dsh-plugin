import { tr } from './locale.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeForwardSearch } from './ArkmeForwardSearch.js'
import { copyText } from './clipboard-text.js'
import { messageSelectionStyles, ArkmeSelectActionIcon } from './message-selection-presentation.js'
import { arkmeSourceAllowsUserWrite } from '../topic-policy.js'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  ArkmeMessageCopyLinkResult,
  ArkmeSourceItem,
  ArkmeSourceList,
  ArkmeSourceSendResult,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

export interface ArkmeMessageSelectionItem {
  id: string
  copyText: string
}

export interface ArkmeMessageActionViewItem extends ArkmeMessageSelectionItem {
  actionRef: string
  conversationRef: string
  copyLinkAvailable: boolean
  forwardAvailable: boolean
}

export function arkmeMessageActionConversationRef(
  items: readonly ArkmeMessageActionViewItem[],
): string | undefined {
  if (items.length === 0 || items.some(item => item.conversationRef.trim() === '')) return undefined
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

export function arkmeMessageActionCopyText(item: ArkmeMessageSelectionItem): string {
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

  selectBar: messageSelectionStyles.selectBar,
  selectButton: messageSelectionStyles.selectBarButton,
  icon: messageSelectionStyles.selectBarIconTile,
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
  searchWrap: { margin: '12px 16px 4px', height: 38, flex: 'none' },
  commentInput: { margin: '12px 16px 4px', padding: '9px 11px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.input, color: arkmeTheme.text },
  targetList: { flex: 1, minHeight: 140, overflowY: 'auto', padding: '8px 12px' },
  target: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.text, textAlign: 'left', cursor: 'pointer' },
  targetCheck: { width: 20, height: 20, display: 'grid', placeItems: 'center', border: `1px solid ${arkmeTheme.border}`, borderRadius: 6 },
  dialogFooter: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: `1px solid ${arkmeTheme.border}` },
  dialogButton: { minWidth: 72, height: 34, padding: '0 14px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.elevated, color: arkmeTheme.text, cursor: 'pointer' },
  primary: { border: 0, background: arkmeTheme.accent, color: '#fff' },

}

const FORWARD_TARGET_LIMIT = 80
const MAX_FORWARD_TARGET_SELECTION = 5
const MESSAGE_ACTION_REQUEST_TIMEOUT_MS = 30_000



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
  /** Visible selection facts, independent of the signed action capabilities. */
  selectionItems?: readonly ArkmeMessageSelectionItem[]
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
  const selectable = useMemo(() => input.selectionItems ?? input.items.filter(item => item.actionRef.trim() !== ''), [input.selectionItems, input.items])
  const selectedContent = useMemo(() => selectable.filter(item => selectedIds?.has(item.id)), [selectable, selectedIds])
  const completeBatch = selected.length > 0 && selected.length === selectedContent.length && selected.length <= 100
    && arkmeMessageActionConversationRef(selected) !== undefined

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
    const visible = new Set(selectable.filter(item => selectedIds.has(item.id)).map(item => item.id))
    if (visible.size === 0) setSelectedIds(undefined)
    else if (visible.size !== selectedIds.size) setSelectedIds(visible)
  }, [selectable, selectedIds])


  const openMenu = useCallback((item: ArkmeMessageActionViewItem, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy !== undefined) return
    setMenu({
      itemId: item.id,
      left: event.clientX,
      top: event.clientY,
    })
  }, [busy])

  const enter = useCallback((item: ArkmeMessageActionViewItem) => {
    if (item.actionRef.trim() === '' || busy !== undefined) return
    setMenu(undefined)
    setSelectedIds(new Set([item.id]))
  }, [busy])

  const toggle = useCallback((item: ArkmeMessageSelectionItem) => {
    if (busy !== undefined || !selectable.some(value => value.id === item.id)) return
    if (input.selectionItems !== undefined) {
      setSelectedIds(current => arkmeToggleMessageActionSelection(current ?? new Set(), item.id, Infinity))
      return
    }
    const actionItem = input.items.find(value => value.id === item.id)!
    setSelectedIds(current => {
      const selectedItems = arkmeMessageActionSelection(input.items, current ?? new Set())
      if (!current?.has(item.id) && arkmeMessageActionConversationRef([...selectedItems, actionItem]) === undefined) {
        showStatus('不能跨会话多选')
        return current
      }
      return arkmeToggleMessageActionSelection(current ?? new Set(), item.id)
    })
  }, [busy, input.items, input.selectionItems, selectable, showStatus])

  const selectMany = useCallback((keys: ReadonlySet<string>) => {
    if (busy !== undefined || picker !== undefined || input.selectionItems === undefined) return
    const valid = selectable.filter(item => keys.has(item.id)).map(item => item.id)
    if (valid.length === 0) return
    setMenu(undefined)
    setSelectedIds(current => new Set([...(current ?? []), ...valid]))
  }, [busy, picker, input.selectionItems, selectable])

  const copyOne = useCallback(async (item: ArkmeMessageSelectionItem) => {
    const revision = revisionRef.current
    setMenu(undefined)
    const value = arkmeMessageActionCopyText(item)
    if (value === '') { showStatus('当前消息没有可复制文本', revision); return }
    try { await copyText(value); showStatus('已复制', revision) }
    catch (error) { showStatus(errorMessage(error) || '复制失败，请稍后重试', revision) }
  }, [showStatus])

  const copyLink = useCallback(async (items: readonly ArkmeMessageActionViewItem[]) => {
    if (busy !== undefined || items.length === 0 || items.length > 100 || items.some(item => !item.copyLinkAvailable)) return
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
    if (busy !== undefined || items.length === 0 || items.length > 100 || items.some(item => !item.forwardAvailable)) { showStatus('所选消息暂不支持转发'); return }
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
      for (const target of [...root.items, ...self.items].filter(arkmeSourceAllowsUserWrite)) {
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
  }, [busy, showStatus])

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
        error: tr("已转发 {v0} 个目标，{v1} 个失败，可重试", { v0: String(successes.length), v1: String(failures) }),
      })
      setBusy(undefined)
      showStatus(tr("已转发 {v0} 个目标，{v1} 个失败", { v0: String(successes.length), v1: String(failures) }))
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
    showStatus(tr("已转发到 {v0} 个目标", { v0: String(successes.length) }))
  }, [busy, input, picker, showStatus])

  const menuItem = menu === undefined ? undefined : input.items.find(item => item.id === menu.itemId)
  const filteredTargets = picker === undefined ? [] : picker.targets.filter(target => {
    const keyword = picker.keyword.trim().toLowerCase()
    return keyword === '' || `${target.displayName} ${targetMeta(target)}`.toLowerCase().includes(keyword)
  })

  const overlay = <>
    {menu !== undefined && menuItem !== undefined && <ArkmeActionMenu label={tr("消息操作")}
      point={{ x: menu.left, y: menu.top }} onClose={() => setMenu(undefined)} actions={[
        { id: 'copy', label: '复制', icon: <MessageActionIcon kind="copy" size={16} />, onSelect: () => { void copyOne(menuItem) } },
        { id: 'link', label: '复制链接', icon: <MessageActionIcon kind="link" size={16} />, disabled: !menuItem.copyLinkAvailable, onSelect: () => { void copyLink([menuItem]) } },
        { id: 'select', label: '多选', icon: <MessageActionIcon kind="select" size={16} />, onSelect: () => enter(menuItem) },
        { id: 'forward', label: '转发', icon: <MessageActionIcon kind="forward" size={16} />, disabled: !menuItem.forwardAvailable, onSelect: () => { void openForward([menuItem]) } },
      ]} />}
    {status !== '' && <div style={styles.status} role="status">{status}</div>}
    {picker !== undefined && <div style={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && busy !== 'forward') setPicker(undefined) }}>
      <section style={styles.dialog} role="dialog" aria-modal="true" aria-label={tr("选择转发对象")}>
        <header style={styles.dialogHeader}><h3 style={styles.dialogTitle}>{tr("转发给")}</h3><button data-arkme-feedback="neutral" type="button" aria-label={tr("关闭转发对象选择")} style={styles.closeButton} disabled={busy === 'forward'} onClick={() => { setPicker(undefined) }}><MessageActionIcon kind="close" size={16} /></button></header>
        <div style={styles.searchWrap}>
          <ArkmeForwardSearch value={picker.keyword} disabled={busy === 'forward'} onChange={event => { setPicker({ ...picker, keyword: event.target.value }) }} />
        </div>
        <div style={styles.targetList}>
          {picker.loading ? <div>{tr("正在加载…")}</div> : filteredTargets.map(target => {
            const selectedTarget = picker.selectedRefs.includes(target.sourceRef)
            return <button data-arkme-feedback="neutral" key={target.sourceRef} type="button" style={styles.target} disabled={busy === 'forward'} onClick={() => {
              if (busy === 'forward') return
              if (!selectedTarget && picker.selectedRefs.length >= MAX_FORWARD_TARGET_SELECTION) {
                showStatus(tr("最多选择 {v0} 个转发对象", { v0: String(MAX_FORWARD_TARGET_SELECTION) }))
                return
              }
              const refs = selectedTarget ? picker.selectedRefs.filter(ref => ref !== target.sourceRef) : [...picker.selectedRefs, target.sourceRef]
              setPicker({ ...picker, selectedRefs: refs, error: '' })
            }}><span style={{ ...styles.targetCheck, background: selectedTarget ? arkmeTheme.accent : 'transparent', color: selectedTarget ? '#fff' : arkmeTheme.text }}>{selectedTarget ? '✓' : ''}</span><span style={{ flex: 1 }}><strong>{target.displayName}</strong><small style={{ display: 'block', color: arkmeTheme.secondary }}>{targetMeta(target)}</small></span></button>
          })}
          {picker.error !== '' && <div style={{ color: arkmeTheme.danger, padding: 8 }}>{picker.error}</div>}
        </div>
        <textarea style={{ ...styles.commentInput, minHeight: 58, resize: 'vertical' }} value={picker.commentText} placeholder={tr("附言（可选）")} disabled={busy === 'forward' || picker.submitted} onChange={event => { setPicker({ ...picker, commentText: event.target.value }) }} />
        <footer style={styles.dialogFooter}><button data-arkme-feedback="neutral" type="button" style={styles.dialogButton} disabled={busy === 'forward'} onClick={() => { setPicker(undefined) }}>{tr("取消")}</button><button data-arkme-feedback="primary" type="button" style={{ ...styles.dialogButton, ...styles.primary, opacity: picker.selectedRefs.length === 0 || busy === 'forward' ? .45 : 1 }} disabled={picker.selectedRefs.length === 0 || busy === 'forward'} onClick={() => { void confirmForward() }}>{busy === 'forward' ? '转发中…' : tr("转发")}</button></footer>
      </section>
    </div>}
  </>

  const selectionBar = selectedIds === undefined ? undefined : <>{input.selectionItems !== undefined && !completeBatch && selectedContent.length > 0 && <div role="status" style={{ color: arkmeTheme.secondary, padding: '6px 16px', fontSize: 12 }}>{selectedContent.length > 100 ? '批量操作最多支持 100 条消息，请减少选择后操作' : '选中消息暂不支持整批复制链接或转发，可调整选择后操作'}</div>}<div style={styles.selectBar} role="toolbar" aria-label={tr("已选择 {v0} 条消息", { v0: String(selectedContent.length) })}>
    <button data-arkme-feedback="neutral" type="button" aria-label={tr("复制文本")} style={{ ...styles.selectButton, ...(selectedContent.length === 1 && busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={selectedContent.length !== 1 || busy !== undefined} onClick={() => { const first = selectedContent[0]; if (first !== undefined) void copyOne(first) }}><span style={styles.icon}><ArkmeSelectActionIcon kind="copy" size={22} /></span><span style={messageSelectionStyles.selectBarLabel}>{tr("复制文本")}</span></button>
    <button data-arkme-feedback="neutral" type="button" aria-label={tr("复制链接")} style={{ ...styles.selectButton, ...(completeBatch && selected.every(item => item.copyLinkAvailable) && busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={!completeBatch || selected.some(item => !item.copyLinkAvailable) || busy !== undefined} onClick={() => { if (completeBatch) void copyLink(selected) }}><span style={styles.icon}><ArkmeSelectActionIcon kind="link" size={22} /></span><span style={messageSelectionStyles.selectBarLabel}>{tr("复制链接")}</span></button>
    <button data-arkme-feedback="neutral" type="button" aria-label={tr("转发")} style={{ ...styles.selectButton, ...(completeBatch && selected.every(item => item.forwardAvailable) && busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={!completeBatch || selected.some(item => !item.forwardAvailable) || busy !== undefined} onClick={() => { if (completeBatch) void openForward(selected) }}><span style={styles.icon}><ArkmeSelectActionIcon kind="forward" size={22} /></span><span style={messageSelectionStyles.selectBarLabel}>{busy === 'forward' ? '转发中' : tr("转发")}</span></button>
    <button data-arkme-feedback="neutral" type="button" style={{ ...styles.selectButton, ...(busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={busy !== undefined} onClick={() => { setSelectedIds(undefined); requestIdsRef.current = undefined }} aria-label={tr("退出多选")}><span style={styles.icon}><ArkmeSelectActionIcon kind="close" size={18} /></span><span style={messageSelectionStyles.selectBarLabel}>{tr("退出多选")}</span></button>
  </div></>

  return { selectMany, canSelectMany: input.selectionItems !== undefined && busy === undefined && picker === undefined, selecting: selectedIds !== undefined, selectedIds: selectedIds ?? new Set<string>(), openMenu, toggle, overlay, selectionBar }
}
