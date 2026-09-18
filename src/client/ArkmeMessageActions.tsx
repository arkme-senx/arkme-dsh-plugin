import { ArkmeForwardPicker, type ForwardSourcePresentation } from './ArkmeForwardPicker.js'
import { copyText } from './clipboard-text.js'
import { messageSelectionStyles, messageSelectionMenuStyles, ArkmeSelectActionIcon } from './message-selection-presentation.js'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  ArkmeMessageCopyLinkResult,
  ArkmeSourceItem,
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

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}


function MessageActionIcon({ kind, size = 18 }: { kind: 'copy' | 'link' | 'select' | 'forward'; size?: number }) {
  if (kind === 'copy') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden><rect x="6" y="6" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M14 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" stroke="currentColor" strokeWidth="1.5" /></svg>
  if (kind === 'link') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden><path d="M13.1 10.9a5.75 5.75 0 0 1 0 8.1 5.75 5.75 0 0 1-8.1 0 5.75 5.75 0 0 1 0-8.1M10.6 13.4a5.75 5.75 0 0 1 0-8.1 5.75 5.75 0 0 1 8.1 0 5.75 5.75 0 0 1 0 8.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  if (kind === 'select') return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden><path d="m2 4 1.3 1.3L6 2.7M9 4h9M2 10l1.3 1.3L6 8.7M9 10h9M2 16l1.3 1.3L6 14.7M9 16h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden><path d="m7.4 6.3 8.5-2.8c3.8-1.3 5.9.8 4.6 4.6l-2.8 8.5c-1.9 5.7-5 5.7-6.9 0L10 14.1l-2.6-.9c-5.7-1.9-5.7-5 0-6.9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="m10.1 13.7 3.6-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
}

const styles: Record<string, CSSProperties> = {
  ...messageSelectionMenuStyles,
  selectBar: messageSelectionStyles.selectBar,
  selectButton: messageSelectionStyles.selectBarButton,
  icon: messageSelectionStyles.selectBarIconTile,
  status: {
    position: 'fixed', left: '50%', bottom: 102, zIndex: 1800, transform: 'translateX(-50%)',
    padding: '8px 12px', borderRadius: 9, background: 'rgba(23,25,28,.9)', color: '#fff',
    fontSize: 12, lineHeight: '18px', pointerEvents: 'none',
  },
}

const MESSAGE_ACTION_REQUEST_TIMEOUT_MS = 30_000
const MESSAGE_ACTION_MENU_OUTER_WIDTH = 178
const MESSAGE_ACTION_MENU_OUTER_HEIGHT = 4 * 34 + (6 + 1) * 2


interface MenuState { itemId: string; left: number; top: number }

export function useArkmeMessageActions(input: {
  scopeKey: string
  items: readonly ArkmeMessageActionViewItem[]
  /** Visible selection facts, independent of the signed action capabilities. */
  selectionItems?: readonly ArkmeMessageSelectionItem[]
  forwardSource?: ForwardSourcePresentation
  onForwarded?: (target: ArkmeSourceItem, result: ArkmeSourceSendResult) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>()
  const [menu, setMenu] = useState<MenuState>()
  const [picker, setPicker] = useState<{ items: readonly ArkmeMessageActionViewItem[]; open: boolean }>()
  const [busy, setBusy] = useState<'copy-link'>()
  const [status, setStatus] = useState('')
  const revisionRef = useRef(0)
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
  }, [input.scopeKey])

  useEffect(() => {
    if (selectedIds === undefined) return
    const visible = new Set(selectable.filter(item => selectedIds.has(item.id)).map(item => item.id))
    if (visible.size === 0) setSelectedIds(undefined)
    else if (visible.size !== selectedIds.size) setSelectedIds(visible)
  }, [selectable, selectedIds])

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
    if (item.actionRef.trim() === '' || busy !== undefined || picker?.open) return
    setPicker(undefined)
    setMenu(undefined)
    setSelectedIds(new Set([item.id]))
  }, [busy, picker])

  const toggle = useCallback((item: ArkmeMessageSelectionItem) => {
    if (busy !== undefined || picker?.open || !selectable.some(value => value.id === item.id)) return
    setPicker(undefined)
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
  }, [busy, picker, input.items, input.selectionItems, selectable, showStatus])

  const selectMany = useCallback((keys: ReadonlySet<string>) => {
    if (busy !== undefined || picker?.open === true || input.selectionItems === undefined) return
    const valid = selectable.filter(item => keys.has(item.id)).map(item => item.id)
    if (valid.length === 0) return
    setPicker(undefined)
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
      setPicker(undefined)
      showStatus('已复制链接')
    } catch (error) {
      if (revision === revisionRef.current) showStatus(controller.signal.aborted ? '复制链接超时，请重试' : errorMessage(error) || '分享失败，请重试')
    } finally {
      window.clearTimeout(timeout)
      if (revision === revisionRef.current) setBusy(undefined)
    }
  }, [busy, showStatus])

  const openForward = useCallback((items: readonly ArkmeMessageActionViewItem[]) => {
    setMenu(undefined)
    if (busy !== undefined || items.length === 0 || items.length > 100 || items.some(item => !item.forwardAvailable)) { showStatus('所选消息暂不支持转发'); return }
    if (arkmeMessageActionConversationRef(items) === undefined) { showStatus('不能跨会话转发'); return }
    setPicker(current => current && current.items.length === items.length && current.items.every((item, index) => item.id === items[index]?.id && item.conversationRef === items[index]?.conversationRef)
      ? { ...current, open: true } : { items: items.map(item => ({ ...item })), open: true })
  }, [busy, showStatus])

  const menuItem = menu === undefined ? undefined : input.items.find(item => item.id === menu.itemId)
  const overlay = <>
    {menu !== undefined && menuItem !== undefined && <div style={{ ...styles.menu, left: menu.left, top: menu.top }} onMouseDown={event => { event.stopPropagation() }} role="menu" aria-label="消息操作">
      <button type="button" role="menuitem" aria-label="复制" style={styles.menuButton} onClick={() => { void copyOne(menuItem) }}><span style={styles.menuIcon}><MessageActionIcon kind="copy" size={16} /></span><span>复制</span></button>
      <button type="button" role="menuitem" aria-label="复制链接" style={{ ...styles.menuButton, opacity: menuItem.copyLinkAvailable ? 1 : .4 }} disabled={!menuItem.copyLinkAvailable} onClick={() => { void copyLink([menuItem]) }}><span style={styles.menuIcon}><MessageActionIcon kind="link" size={16} /></span><span>复制链接</span></button>
      <button type="button" role="menuitem" aria-label="多选" style={styles.menuButton} onClick={() => { enter(menuItem) }}><span style={styles.menuIcon}><MessageActionIcon kind="select" size={16} /></span><span>多选</span></button>
      <button type="button" role="menuitem" aria-label="转发" style={{ ...styles.menuButton, opacity: menuItem.forwardAvailable ? 1 : .4 }} disabled={!menuItem.forwardAvailable} onClick={() => { void openForward([menuItem]) }}><span style={styles.menuIcon}><MessageActionIcon kind="forward" size={18} /></span><span>转发</span></button>
    </div>}
    {status !== '' && <div style={styles.status} role="status">{status}</div>}
    {picker !== undefined && <ArkmeForwardPicker key={JSON.stringify([input.scopeKey, ...picker.items.map(item => [item.conversationRef, item.id])])} open={picker.open} {...(input.forwardSource ? { source: input.forwardSource } : {})} messageCount={picker.items.length}
      delivery={{ send: async (target, identity, commentText, signal) => {
        if (picker.items.some(item => !input.items.some(current => current.id === item.id && current.forwardAvailable && current.conversationRef === item.conversationRef))) {
          throw new Error('所选消息已变化，请退出后重新选择')
        }
        return await callArkme<ArkmeSourceSendResult>('message-actions.forward', {
          conversationRef: arkmeMessageActionConversationRef(picker.items), targetSourceRef: target.sourceRef,
          actionRefs: picker.items.map(item => item.actionRef), requestId: `arkme-forward-${identity.requestId}`,
          recordUid: identity.recordUid, commentRecordUid: identity.commentRecordUid, sendAtMillis: identity.sendAtMillis,
          ...(commentText ? { commentText } : {}),
        }, signal)
      } }}
      onClose={() => setPicker(current => current && { ...current, open: false })} onComplete={() => { setPicker(undefined); setSelectedIds(undefined) }}
      onStatus={showStatus} {...(input.onForwarded ? { onForwarded: input.onForwarded } : {})} />}

  </>

  const selectionBar = selectedIds === undefined ? undefined : <>{input.selectionItems !== undefined && !completeBatch && selectedContent.length > 0 && <div role="status" style={{ color: arkmeTheme.secondary, padding: '6px 16px', fontSize: 12 }}>{selectedContent.length > 100 ? '批量操作最多支持 100 条消息，请减少选择后操作' : '选中消息暂不支持整批复制链接或转发，可调整选择后操作'}</div>}<div style={styles.selectBar} role="toolbar" aria-label={`已选择 ${String(selectedContent.length)} 条消息`}>
    <button type="button" aria-label="复制文本" style={{ ...styles.selectButton, ...(selectedContent.length === 1 && busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={selectedContent.length !== 1 || busy !== undefined} onClick={() => { const first = selectedContent[0]; if (first !== undefined) void copyOne(first) }}><span style={styles.icon}><ArkmeSelectActionIcon kind="copy" size={22} /></span><span style={messageSelectionStyles.selectBarLabel}>复制文本</span></button>
    <button type="button" aria-label="复制链接" style={{ ...styles.selectButton, ...(completeBatch && selected.every(item => item.copyLinkAvailable) && busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={!completeBatch || selected.some(item => !item.copyLinkAvailable) || busy !== undefined} onClick={() => { if (completeBatch) void copyLink(selected) }}><span style={styles.icon}><ArkmeSelectActionIcon kind="link" size={22} /></span><span style={messageSelectionStyles.selectBarLabel}>复制链接</span></button>
    <button type="button" aria-label="转发" style={{ ...styles.selectButton, ...(completeBatch && selected.every(item => item.forwardAvailable) && busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={!completeBatch || selected.some(item => !item.forwardAvailable) || busy !== undefined} onClick={() => { if (completeBatch) void openForward(selected) }}><span style={styles.icon}><ArkmeSelectActionIcon kind="forward" size={22} /></span><span style={messageSelectionStyles.selectBarLabel}>转发</span></button>
    <button type="button" style={{ ...styles.selectButton, ...(busy === undefined ? {} : messageSelectionStyles.selectBarButtonDisabled) }} disabled={busy !== undefined} onClick={() => { setSelectedIds(undefined); setPicker(undefined) }} aria-label="退出多选"><span style={styles.icon}><ArkmeSelectActionIcon kind="close" size={18} /></span><span style={messageSelectionStyles.selectBarLabel}>退出多选</span></button>
  </div></>

  return { selectMany, canSelectMany: input.selectionItems !== undefined && busy === undefined && picker?.open !== true, selecting: selectedIds !== undefined, selectedIds: selectedIds ?? new Set<string>(), openMenu, toggle, overlay, selectionBar }
}
