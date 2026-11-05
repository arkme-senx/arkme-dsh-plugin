import type { KeyboardEvent, MouseEvent } from 'react'

/** Reply cards must not consume links, media controls, portals, or text selection. */
export function detailReplyClickAllowed(event: MouseEvent<HTMLElement> | undefined): boolean {
  if (event?.defaultPrevented) return false
  if (typeof Element !== 'undefined' && event?.target instanceof Element) {
    if (!event.currentTarget.contains(event.target)) return false
    if (event.target.closest('a,button,input,select,textarea,audio,video,[contenteditable],[role=link],[role=slider]')) return false
  }
  return !(typeof window !== 'undefined' && window.getSelection?.()?.toString())
}

export function activateDetailReplyKey(event: KeyboardEvent<HTMLElement>, activate: () => void): void {
  if (event.defaultPrevented || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  activate()
}
