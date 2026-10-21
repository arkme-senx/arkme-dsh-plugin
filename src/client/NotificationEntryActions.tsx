import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeNotificationPreview } from './ArkmeNotificationPreview.js'
import { notificationDirectoryPreferences, useNotificationDirectoryPin } from './notification-directory-preferences.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export function useNotificationEntryActions(accountKey: string | undefined, active: boolean, onOpen: () => void) {
  const pinned = useNotificationDirectoryPin(accountKey ?? '')
  const [point, setPoint] = useState<{ account: string; x: number; y: number }>()
  const [previewAccount, setPreviewAccount] = useState<string>()
  const [error, setError] = useState('')
  const trigger = useRef<HTMLElement>()
  useEffect(() => { setPoint(undefined); setPreviewAccount(undefined); setError('') }, [accountKey, active])
  const closePreview = () => { setPreviewAccount(undefined); trigger.current?.focus({ preventScroll: true }) }
  return {
    pinned,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation()
      if (!accountKey || !active) return
      trigger.current = event.currentTarget
      trigger.current.focus({ preventScroll: true })
      const rect = event.currentTarget.getBoundingClientRect()
      setError('')
      setPoint({ account: accountKey, x: event.clientX || rect.left + 20, y: event.clientY || rect.top + 20 })
    },
    overlays: active && accountKey && <>
      {point?.account === accountKey && <ArkmeActionMenu label={tr('通知的会话操作')} point={point} autoFocus onClose={() => setPoint(undefined)} actions={[
        { id: 'preview', label: tr('预览'), onSelect: () => { setPoint(undefined); setPreviewAccount(accountKey) } },
        { id: 'pin', label: tr(pinned ? '取消置顶' : '置顶对话'), onSelect: () => {
          setPoint(undefined)
          try { notificationDirectoryPreferences.pin(accountKey, !pinned); setError('') }
          catch (caught) { setError(caught instanceof Error ? caught.message : tr('操作失败，请重试')) }
        } },
      ]} />}
      {previewAccount === accountKey && <ArkmeNotificationPreview key={accountKey} onClose={closePreview} onOpen={onOpen} />}
      {error && typeof document !== 'undefined' && createPortal(<div role="alert" style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 1000, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow, padding: '10px 16px', borderRadius: 8 }}>{error}</div>, document.body)}
    </>,
  }
}
