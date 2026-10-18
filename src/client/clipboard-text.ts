export async function copyText(value: string, doc: Document = document): Promise<void> {
  if (doc.defaultView?.navigator.clipboard?.writeText !== undefined) {
    try {
      await doc.defaultView.navigator.clipboard.writeText(value)
      return
    } catch {
      // Embedded WebViews may expose Clipboard but deny it; match the normal
      // conversation surface by falling back to the selected textarea path.
    }
  }
  const textarea = doc.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  doc.body.appendChild(textarea)
  const selection = doc.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const activeElement = doc.activeElement instanceof doc.defaultView!.HTMLElement ? doc.activeElement : undefined
  try {
    textarea.select()
    if (!doc.execCommand('copy')) throw new Error('复制失败，请稍后重试')
  } finally {
    textarea.remove()
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) if (range.commonAncestorContainer.isConnected) selection.addRange(range)
    }
  }
}
