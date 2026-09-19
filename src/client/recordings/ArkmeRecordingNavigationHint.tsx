import { useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { recordingClock } from './ArkmeDirectRecording.js'
import { useRecordingBreathStyle } from './recording-breath.js'

/** A read-only hint; clicking the navigation button still opens Recordings. */
export function ArkmeRecordingNavigationHint({ anchor, elapsedMillis, startedAt, id }: {
  anchor: RefObject<HTMLButtonElement>
  elapsedMillis: number
  startedAt: number
  id: string
}) {
  const breathStyle = useRecordingBreathStyle(true, startedAt)
  const [position, setPosition] = useState<{ left: number; top: number; width: number }>()
  useLayoutEffect(() => {
    const button = anchor.current
    const view = button?.ownerDocument.defaultView
    if (!button || !view) return
    const positionHint = () => {
      const rect = button.getBoundingClientRect()
      const width = Math.min(248, Math.max(0, view.innerWidth - 16))
      setPosition({
        left: Math.max(8, Math.min(rect.right + 8, view.innerWidth - width - 8)),
        top: Math.max(8, Math.min(rect.top, view.innerHeight - 94)),
        width,
      })
    }
    positionHint()
    view.addEventListener('resize', positionHint)
    view.addEventListener('scroll', positionHint, true)
    return () => {
      view.removeEventListener('resize', positionHint)
      view.removeEventListener('scroll', positionHint, true)
    }
  }, [anchor])
  const body = anchor.current?.ownerDocument.body
  if (!body || !position) return null
  return createPortal(<div id={id} role="tooltip" data-arkme-recording-navigation-hint
    style={{ ...breathStyle, position: 'fixed', ...position, zIndex: 90, padding: '12px 14px', boxSizing: 'border-box',
      border: `1px solid ${theme.border}`, borderRadius: 10, background: theme.menu, color: theme.text,
      boxShadow: theme.shadow, pointerEvents: 'none', fontSize: 13, lineHeight: '20px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span data-arkme-recording-breath="dot" aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: theme.danger, flex: 'none' }} />
      <span>本机正在录音</span>
      <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{recordingClock(elapsedMillis)}</span>
    </div>
    <div style={{ marginTop: 4, fontSize: 12, color: theme.secondary }}>点击查看录音 · 本机保存中</div>
  </div>, body)
}
