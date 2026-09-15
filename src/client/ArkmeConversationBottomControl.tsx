import { useEffect, useRef, useState, type CSSProperties } from 'react'
import backBottomIcon from '../../assets/icons/icon_back_bottom_green.svg'
import { arkmeTheme } from './arkme-theme.js'

interface Props {
  showBackToBottom: boolean
  newMessageCount: number
  onReturnToLatest: () => Promise<void>
}

const button: CSSProperties = {
  pointerEvents: 'auto', border: `1px solid ${arkmeTheme.border}`, borderRadius: 36,
  background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

/** Mount per conversation/account. Data loading and viewport movement belong to the caller. */
export function ArkmeConversationBottomControl({ showBackToBottom, newMessageCount, onReturnToLatest }: Props) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!showBackToBottom && newMessageCount === 0 && failed) setFailed(false)
  }, [failed, newMessageCount, showBackToBottom])
  const activate = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setFailed(false)
    try {
      await onReturnToLatest()
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      inFlight.current = false
      if (mounted.current) setPending(false)
    }
  }
  if (!showBackToBottom && newMessageCount === 0 && !pending && !failed) return null
  return <div data-arkme-bottom-controls style={{ position: 'absolute', inset: 'auto 24px 10px', zIndex: 4, pointerEvents: 'none' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minHeight: 30 }}>
      {newMessageCount > 0 && <button type="button" disabled={pending} onClick={() => { void activate() }}
        style={{ ...button, position: 'absolute', left: '50%', transform: 'translateX(-50%)', padding: '7px 13px', fontSize: 12 }}>
        {newMessageCount} 条新消息
      </button>}
      {(showBackToBottom || pending || failed) && <button type="button" aria-label="回到底部"
        title={pending ? '正在回到底部…' : '回到底部'} aria-busy={pending} disabled={pending}
        onClick={() => { void activate() }} style={{ ...button, width: 50, height: 30, flexShrink: 0, opacity: pending ? 0.6 : 1 }}>
        <img src={`data:image/svg+xml;base64,${backBottomIcon}`} width={24} height={24} style={{ objectFit: 'none', filter: 'brightness(0)' }} alt="" aria-hidden />
      </button>}
    </div>
    {failed && <div role="alert" data-arkme-bottom-error style={{ textAlign: 'right', color: arkmeTheme.danger, background: arkmeTheme.base, fontSize: 12, marginTop: 6 }}>
      暂时无法回到底部，请重试
    </div>}
  </div>
}
