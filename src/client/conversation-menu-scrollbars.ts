import { CONVERSATION_MENU_LAYOUT } from './conversation-selector-style.js'

/** The native DSH recipe: reveal on entry, linger for 2s on exit, never resize. */
export function watchConversationMenuScrollbars(menu: HTMLElement, list: HTMLElement): () => void {
  const doc = menu.ownerDocument
  const win = doc.defaultView!
  let timer: number | undefined
  let visible = false
  const setVisible = (next: boolean) => {
    visible = next
    menu.setAttribute('data-arkme-menu-scrollbars', next ? 'visible' : 'quiet')
  }
  const cancel = () => { win.clearTimeout(timer); timer = undefined }
  const enter = () => { cancel(); setVisible(true) }
  const leave = () => {
    if (!visible || timer !== undefined) return
    timer = win.setTimeout(() => { timer = undefined; setVisible(false) }, CONVERSATION_MENU_LAYOUT.scrollbarLingerMs)
  }
  const move = (event: MouseEvent) => {
    if (!visible) return
    const rect = menu.getBoundingClientRect()
    if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom) cancel()
    else leave()
  }
  list.setAttribute('data-arkme-menu-scroll', '')
  setVisible(menu.matches(':hover'))
  menu.addEventListener('pointerenter', enter)
  menu.addEventListener('pointerleave', leave)
  menu.addEventListener('dragenter', enter)
  doc.addEventListener('pointermove', move)
  doc.addEventListener('dragover', move)
  return () => {
    cancel()
    menu.removeEventListener('pointerenter', enter)
    menu.removeEventListener('pointerleave', leave)
    menu.removeEventListener('dragenter', enter)
    doc.removeEventListener('pointermove', move)
    doc.removeEventListener('dragover', move)
    menu.removeAttribute('data-arkme-menu-scrollbars')
    list.removeAttribute('data-arkme-menu-scroll')
  }
}
