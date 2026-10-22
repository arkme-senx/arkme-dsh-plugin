import { arkmeEmojiUnicode } from '../arkme-emoji-text.js'

const blockTags = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TABLE'])

export function captureMessageContextMenu(event: Pick<MouseEvent, 'preventDefault' | 'stopPropagation' | 'clientX' | 'clientY'>, anchor?: HTMLElement) {
  event.preventDefault()
  event.stopPropagation()
  return { left: event.clientX, top: event.clientY, selectedText: captureMessageTextSelection(anchor) }
}

/** Only used when inline emoji/read decorations need conversion. Keep block
 * boundaries as well as explicit newlines instead of flattening textContent. */
function fragmentText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType === 1 && (node as Element).tagName === 'BR') return '\n'
  let text = ''
  let previousBlock = false
  for (const child of node.childNodes) {
    const block = child.nodeType === 1 && blockTags.has((child as Element).tagName)
    const value = fragmentText(child)
    if (value === '') continue
    if ((block || previousBlock) && text !== '' && !text.endsWith('\n') && !value.startsWith('\n')) text += '\n'
    text += value
    previousBlock = block
  }
  return text
}

/** Capture before opening a focusable menu. Never consult the live selection
 * from a menu click, or reuse a selection belonging to another message/editor. */
export function captureMessageTextSelection(bubble: HTMLElement | undefined): string | undefined {
  const selection = bubble?.ownerDocument?.getSelection()
  if (!bubble || !selection || selection.isCollapsed || selection.rangeCount !== 1
    || !bubble.contains(selection.anchorNode) || !bubble.contains(selection.focusNode)) return undefined
  const fragment = selection.getRangeAt(0).cloneContents()
  let converted = false
  for (const indicator of fragment.querySelectorAll('[data-arkme-mention-read],style,script,button,input,textarea,select,[aria-hidden="true"]')) {
    indicator.remove()
    converted = true
  }
  for (const image of fragment.querySelectorAll('img[data-arkme-rich-emoji]')) {
    const emoji = arkmeEmojiUnicode(image.getAttribute('data-arkme-rich-emoji') ?? '')
    if (emoji !== '') {
      image.replaceWith(emoji)
      converted = true
    }
  }
  const text = converted ? fragmentText(fragment) : selection.toString()
  return text.trim() === '' ? undefined : text
}
