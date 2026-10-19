import { useEffect, useRef } from 'react'

const eventName = 'arkme:selection-search'
/** Synchronous acknowledgement prevents silently dropping a search in another surface. */
export function findSelectedMessageText(sourceRef: string, text: string): boolean {
  return !window.dispatchEvent(new CustomEvent(eventName, { cancelable: true, detail: { sourceRef, text } }))
}

export function useSelectedMessageSearch(sourceRef: string | undefined, search: (text: string) => void) {
  const latest = useRef(search); latest.current = search
  useEffect(() => {
    if (!sourceRef) return
    const listener = (event: Event) => {
      const request = (event as CustomEvent<{ sourceRef: string; text: string }>).detail
      if (event.defaultPrevented || request.sourceRef !== sourceRef || !request.text.trim()) return
      event.preventDefault(); latest.current(request.text)
    }
    window.addEventListener(eventName, listener)
    return () => window.removeEventListener(eventName, listener)
  }, [sourceRef])
}
