import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeAuthSnapshot, ArkmeSourceSendResult } from '../types.js'
import type { NativeChatForwardSnapshot } from '../native-chat-forward-contract.js'
import { ArkmeForwardPicker, type ForwardSourcePresentation } from './ArkmeForwardPicker.js'
import { callArkme } from './api.js'
import { nativeSelectionForwardSnapshot, type NativeChat } from './harness-native-selection.js'
import { ArkmeSelectActionIcon, messageSelectionStyles } from './message-selection-presentation.js'
import { arkmeTheme } from './arkme-theme.js'

export function nativeForwardPreview(snapshot: NativeChatForwardSnapshot): ForwardSourcePresentation {
  const count = snapshot.messages.length
  const first = snapshot.messages[0]
  return {
    title: `我和DeepSeek Harness的${count > 1 ? `${count}条` : ''}快记`,
    subtitle: first ? `${first.role === 'user' ? '我' : 'DeepSeek Harness'}：${first.text.trim().replace(/\s+/g, ' ')}` : '',
  }
}

/** This action exists only for the active native session/selection lifetime. */
export function NativeForwardAction({ chat, keys, sessionId, doc, onComplete, children }: {
  chat: NativeChat; keys: ReadonlySet<string>; sessionId: string; doc: Document; onComplete(): void; children(button: ReactNode): ReactNode
}) {
  const [attempt, setAttempt] = useState<{ snapshot: NativeChatForwardSnapshot; userId: number; open: boolean }>()
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const request = useRef<AbortController>()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort() } }, [])
  const selectionKey = JSON.stringify([...keys].sort())
  useEffect(() => {
    request.current?.abort(); request.current = undefined
    setAttempt(undefined); setLoading(false); setStatus('')
  }, [selectionKey])
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 2800)
    return () => clearTimeout(timer)
  }, [status])
  const open = async () => {
    if (request.current || attempt?.open) return
    if (attempt) { setAttempt({ ...attempt, open: true }); return }
    const controller = new AbortController(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 30_000)
    setLoading(true)
    try {
      const snapshot = nativeSelectionForwardSnapshot(chat, sessionId, keys)
      const auth = await callArkme<ArkmeAuthSnapshot>('auth.status', {}, controller.signal)
      if (!alive.current || request.current !== controller) return
      controller.signal.throwIfAborted()
      if (auth.status !== 'authenticated' || !auth.userId) throw new Error('请先登录 Arkme 后转发')
      setAttempt({ snapshot, userId: auth.userId, open: true })
    } catch (reason) {
      if (alive.current && request.current === controller) setStatus(controller.signal.aborted ? '读取账号超时，请重试' : reason instanceof Error ? reason.message : '无法转发，请重试')
    } finally {
      clearTimeout(timeout)
      if (alive.current && request.current === controller) setLoading(false)
      if (request.current === controller) request.current = undefined
    }
  }
  const disabled = keys.size === 0 || keys.size > 100 || loading || attempt?.open === true
  const button = <>
    <button type="button" aria-label="转发" disabled={disabled} onClick={() => { void open() }}
      style={{ ...messageSelectionStyles.selectBarButton, ...(disabled ? messageSelectionStyles.selectBarButtonDisabled : {}) }}>
      <span style={messageSelectionStyles.selectBarIconTile}><ArkmeSelectActionIcon kind="forward" size={22} /></span>
      <span style={messageSelectionStyles.selectBarLabel}>{loading ? '准备中…' : '转发'}</span>
    </button>
    {status && <span role="status" style={{ position: 'absolute', top: 4, left: 0, right: 0, textAlign: 'center', fontSize: 12, color: arkmeTheme.secondary }}>{status}</span>}
  </>
  return <>
    {children(button)}
    {attempt && createPortal(<ArkmeForwardPicker open={attempt.open} source={nativeForwardPreview(attempt.snapshot)} messageCount={attempt.snapshot.messages.length} delivery={{ send: async (target, identity, commentText, signal) => {
      return await callArkme<ArkmeSourceSendResult>('native-chat.forward', {
        snapshot: attempt.snapshot, expectedUserId: attempt.userId, targetSourceRef: target.sourceRef,
        requestId: `dsh-forward-${identity.requestId}`, recordUid: identity.recordUid,
        commentRecordUid: identity.commentRecordUid, sendAtMillis: identity.sendAtMillis, commentText,
      }, signal)
    } }} onClose={() => setAttempt(current => current && { ...current, open: false })} onComplete={onComplete} onStatus={setStatus} />, doc.body)}
  </>
}
