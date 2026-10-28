import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ArkmeAuthSnapshot, ArkmeSourceSendResult } from '../types.js'
import { openNativeForward, nativeForwardDelivery, type NativeForwardContent } from './native-forward-entry.js'
import { callArkme } from './api.js'
import { nativeSelectionSnapshot, type NativeChat } from './harness-native-selection.js'
import { ArkmeSelectActionIcon, messageSelectionStyles } from './message-selection-presentation.js'
import { arkmeTheme } from './arkme-theme.js'

/** This action exists only for the active native session/selection lifetime. */
export function NativeForwardAction({ chat, keys, sessionId, doc, onComplete, children }: {
  chat: NativeChat; keys: ReadonlySet<string>; sessionId: string; doc: Document; onComplete(): void; children(button: ReactNode): ReactNode
}) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const request = useRef<AbortController>()
  const attempt = useRef<NativeForwardContent>()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort() } }, [])
  const selectionKey = JSON.stringify([...keys].sort())
  useEffect(() => {
    request.current?.abort(); request.current = undefined; attempt.current = undefined
    setLoading(false); setStatus('')
  }, [selectionKey])
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 2800)
    return () => clearTimeout(timer)
  }, [status])
  const open = async () => {
    if (request.current) return
    const controller = new AbortController(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 30_000)
    setLoading(true)
    try {
      const snapshot = attempt.current?.snapshot ?? nativeSelectionSnapshot(chat, sessionId, keys)
      const auth = await callArkme<ArkmeAuthSnapshot>('auth.status', {}, controller.signal)
      if (!alive.current || request.current !== controller) return
      controller.signal.throwIfAborted()
      if (auth.status !== 'authenticated' || !auth.userId) throw new Error('请先登录 Arkme 后转发')
      clearTimeout(timeout)
      if (attempt.current && attempt.current.userId !== auth.userId) throw new Error('账号已变化，请重新选择')
      const userId = auth.userId
      attempt.current ??= { snapshot, userId, delivery: nativeForwardDelivery((target, identity, commentText, signal) =>
        callArkme<ArkmeSourceSendResult>('native-chat.forward', { snapshot, expectedUserId: userId, targetSourceRef: target.sourceRef, ...identity, commentText }, signal)) }
      const result = await openNativeForward(doc, attempt.current, controller.signal)
      if (!alive.current || request.current !== controller || controller.signal.aborted) return
      if (result.completed) onComplete()
    } catch (reason) {
      if (alive.current && request.current === controller) setStatus(controller.signal.aborted ? '读取账号超时，请重试' : reason instanceof Error ? reason.message : '无法转发，请重试')
    } finally {
      clearTimeout(timeout)
      if (alive.current && request.current === controller) setLoading(false)
      if (request.current === controller) request.current = undefined
    }
  }
  const disabled = keys.size === 0 || keys.size > 100 || loading
  const button = <>
    <button type="button" aria-label="转发" disabled={disabled} onClick={() => { void open() }}
      style={{ ...messageSelectionStyles.selectBarButton, ...(disabled ? messageSelectionStyles.selectBarButtonDisabled : {}) }}>
      <span style={messageSelectionStyles.selectBarIconTile}><ArkmeSelectActionIcon kind="forward" size={22} /></span>
      <span style={messageSelectionStyles.selectBarLabel}>{loading ? '准备中…' : '转发'}</span>
    </button>
    {status && <span role="status" style={{ position: 'absolute', top: 4, left: 0, right: 0, textAlign: 'center', fontSize: 12, color: arkmeTheme.secondary }}>{status}</span>}
  </>
  return <>{children(button)}</>
}
