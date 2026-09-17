import { useEffect, useRef, useState } from 'react'
import type { ArkmeAuthSnapshot } from '../types.js'
import { callArkme } from './api.js'
import { copyNativeLink, type NativeCopyLinkAttempt } from './native-copy-link-entry.js'
import { nativeSelectionSnapshot, type NativeChat } from './harness-native-selection.js'
import { ArkmeSelectActionIcon, messageSelectionStyles } from './message-selection-presentation.js'
import { arkmeTheme } from './arkme-theme.js'

export function NativeCopyLinkAction({ chat, keys, sessionId, doc }: {
  chat: NativeChat; keys: ReadonlySet<string>; sessionId: string; doc: Document
}) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const request = useRef<AbortController>()
  const attempt = useRef<NativeCopyLinkAttempt>()
  const selectionKey = JSON.stringify([...keys].sort())
  useEffect(() => {
    attempt.current = undefined
    setLoading(false); setStatus('')
    return () => { request.current?.abort(); request.current = undefined }
  }, [selectionKey, sessionId])
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 2800)
    return () => clearTimeout(timer)
  }, [status])
  const copy = async () => {
    if (request.current) return
    const controller = new AbortController(); request.current = controller
    const timeout = setTimeout(() => controller.abort(), 30_000)
    setLoading(true); setStatus('')
    try {
      const snapshot = attempt.current?.snapshot ?? nativeSelectionSnapshot(chat, sessionId, keys)
      const auth = await callArkme<ArkmeAuthSnapshot>('auth.status', {}, controller.signal)
      if (request.current !== controller) return
      controller.signal.throwIfAborted()
      if (auth.status !== 'authenticated' || !auth.userId) throw new Error('请先登录 Arkme 后复制链接')
      if (attempt.current && attempt.current.userId !== auth.userId) throw new Error('账号已变化，请重新选择')
      attempt.current ??= { snapshot, userId: auth.userId }
      await copyNativeLink(doc, attempt.current, controller.signal)
      if (request.current === controller && !controller.signal.aborted) setStatus('复制链接成功')
    } catch (reason) {
      if (request.current === controller) setStatus(controller.signal.aborted ? '复制链接超时，请重试' : reason instanceof Error ? reason.message : '复制链接失败，请重试')
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) { request.current = undefined; setLoading(false) }
    }
  }
  const disabled = keys.size === 0 || keys.size > 100 || loading
  return <>
    <button type="button" aria-label="复制链接" disabled={disabled} onClick={() => { void copy() }}
      style={{ ...messageSelectionStyles.selectBarButton, ...(disabled ? messageSelectionStyles.selectBarButtonDisabled : {}) }}>
      <span style={messageSelectionStyles.selectBarIconTile}><ArkmeSelectActionIcon kind="link" size={22} /></span>
      <span style={messageSelectionStyles.selectBarLabel}>{loading ? '复制中…' : '复制链接'}</span>
    </button>
    {status && <span role="status" style={{ position: 'absolute', top: 4, left: 0, right: 0, textAlign: 'center', fontSize: 12, color: arkmeTheme.secondary }}>{status}</span>}
  </>
}
