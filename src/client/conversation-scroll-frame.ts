import { useCallback, useLayoutEffect, useRef } from 'react'

/** Coalesce scroll affordances; the caller still captures reading geometry immediately. */
export function useConversationScrollFrame(scope: string, callback: () => void) {
  const latest = useRef(callback)
  const frame = useRef<number>()
  useLayoutEffect(() => { latest.current = callback })
  useLayoutEffect(() => () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }, [scope])
  return useCallback(() => {
    if (frame.current !== undefined) return
    frame.current = requestAnimationFrame(() => { frame.current = undefined; latest.current() })
  }, [])
}
