import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { tr } from './locale.js'

// The existing ordinary conversation notice; shared without adding a row to
// the directory layout. Late completions cannot cross its account/entry scope.
const style: CSSProperties = {
  position: 'fixed', zIndex: 10001, left: '50%', bottom: 24, transform: 'translateX(-50%)',
  maxWidth: 360, padding: '9px 13px', borderRadius: 9, background: 'rgba(34, 38, 44, .92)',
  color: '#fff', boxShadow: '0 6px 18px rgba(22, 26, 31, .18)', fontSize: 12, lineHeight: '18px',
}
export const ConversationActionFeedbackContext = createContext<((message: string | undefined) => void) | undefined>(undefined)
export function useConversationActionFeedback(scope: unknown, enabled = true) {
  const parent = useContext(ConversationActionFeedbackContext)
  const current = useRef(scope)
  current.current = scope
  const alive = useRef(true)
  const isEnabled = useRef(enabled)
  isEnabled.current = enabled
  const [notice, setNotice] = useState<{ scope: unknown; message: string }>()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { setNotice(undefined) }, [scope, enabled])
  useEffect(() => {
    if (!enabled || notice === undefined || notice.scope !== scope) return
    const timer = setTimeout(() => setNotice(undefined), 2_200)
    return () => clearTimeout(timer)
  }, [notice, scope, enabled])
  return {
    notify: useCallback((message: string | undefined) => {
      if (!alive.current || !isEnabled.current || current.current !== scope) return
      if (parent) parent(message)
      else setNotice(message === undefined ? undefined : { scope, message })
    }, [scope, parent]),
    feedback: parent === undefined && enabled && notice !== undefined && notice.scope === scope && typeof document !== 'undefined'
      ? createPortal(<div role="status" style={style}>{tr(notice.message)}</div>, document.body) : null,
  }
}
