import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeSourceItem } from '../types.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { BuiltinConversationPreview } from './BuiltinConversationPreview.js'
import { builtinDirectoryPreferences, type BuiltinConversation, type BuiltinPins } from './builtin-directory-preferences.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export function useBuiltinEntryActions(account: string | undefined, active: boolean, pins: BuiltinPins, names: Record<BuiltinConversation, string>, selfSource: () => ArkmeSourceItem | undefined) {
  const [point, setPoint] = useState<{ account: string; entry: BuiltinConversation; x: number; y: number }>()
  const [preview, setPreview] = useState<{ account: string; entry: BuiltinConversation; source?: ArkmeSourceItem | undefined }>()
  const [error, setError] = useState('')
  const trigger = useRef<HTMLElement>()
  useEffect(() => { setPoint(undefined); setPreview(undefined); setError('') }, [account, active])
  const focusTrigger = () => {
    // Pinning moves the row to a different React parent. Recover its new DOM owner.
    const element = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLElement>(`[data-arkme-builtin-entry="${point?.entry ?? preview?.entry}"]`)
    element?.focus({ preventScroll: true })
  }
  return {
    open: (entry: BuiltinConversation, event: MouseEvent<HTMLElement>) => {
      event.preventDefault(); event.stopPropagation()
      if (!account || !active) return
      trigger.current = event.currentTarget; trigger.current.focus({ preventScroll: true })
      const rect = trigger.current.getBoundingClientRect()
      setError(''); setPoint({ account, entry, x: event.clientX || rect.left + 20, y: event.clientY || rect.top + 20 })
    },
    overlays: active && account && <>
      {point?.account === account && <ArkmeActionMenu label={`${names[point.entry]}的会话操作`} point={point} autoFocus onClose={() => setPoint(undefined)} actions={[
        { id: 'preview', label: tr('预览'), onSelect: () => { setPreview({ account, entry: point.entry, source: point.entry === 'self' ? selfSource() : undefined }); setPoint(undefined) } },
        { id: 'pin', label: tr(pins[point.entry] ? '取消置顶' : '置顶对话'), onSelect: () => {
          try { builtinDirectoryPreferences.pin(account, point.entry, !pins[point.entry]); setError('') }
          catch (caught) { setError(caught instanceof Error ? caught.message : tr('操作失败，请重试')) }
          setPoint(undefined)
        } },
      ]} />}
      {preview?.account === account && <BuiltinConversationPreview key={`${account}:${preview.entry}`} kind={preview.entry} name={names[preview.entry]} selfSource={preview.source} onClose={() => { focusTrigger(); setPreview(undefined) }} />}
      {error && typeof document !== 'undefined' && createPortal(<div role="alert" style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 1000, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow, padding: '10px 16px', borderRadius: 8 }}>{error}</div>, document.body)}
    </>,
  }
}
