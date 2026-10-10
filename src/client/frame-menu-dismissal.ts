/** Clicks and keys do not bubble across iframe documents. Watch reachable child documents only while the menu is open. */
export function watchFrameMenuDismissal(root: Document, outside: () => void, keydown: (event: KeyboardEvent) => void): () => void {
  if (typeof root.querySelectorAll !== 'function') return () => {}
  const documents = new Map<Document, () => void>()
  const frames = new Map<HTMLIFrameElement, () => void>()
  let disposed = false
  const sync = () => {
    if (disposed) return
    const nextDocuments = new Set<Document>()
    const nextFrames = new Set<HTMLIFrameElement>()
    const visit = (doc: Document) => {
      if (nextDocuments.has(doc)) return
      nextDocuments.add(doc)
      for (const frame of doc.querySelectorAll('iframe')) {
        nextFrames.add(frame)
        try { if (frame.contentDocument) visit(frame.contentDocument) } catch { /* Cross-origin content is not accessible. */ }
      }
    }
    visit(root)
    for (const [doc, stop] of documents) if (!nextDocuments.has(doc)) { stop(); documents.delete(doc) }
    for (const [frame, stop] of frames) if (!nextFrames.has(frame)) { stop(); frames.delete(frame) }
    for (const frame of nextFrames) {
      if (frames.has(frame)) continue
      frame.addEventListener('load', sync)
      frames.set(frame, () => frame.removeEventListener('load', sync))
    }
    for (const doc of nextDocuments) {
      if (documents.has(doc)) continue
      if (doc !== root) {
        doc.addEventListener('pointerdown', outside, true)
        doc.addEventListener('mousedown', outside, true)
        doc.addEventListener('keydown', keydown, true)
      }
      const observer = new MutationObserver(records => {
        if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
          && ((node as Element).tagName === 'IFRAME' || (node as Element).querySelector('iframe'))))) sync()
      })
      observer.observe(doc, { childList: true, subtree: true })
      documents.set(doc, () => {
        observer.disconnect()
        if (doc !== root) {
          doc.removeEventListener('pointerdown', outside, true)
          doc.removeEventListener('mousedown', outside, true)
          doc.removeEventListener('keydown', keydown, true)
        }
      })
    }
  }
  sync()
  return () => {
    disposed = true
    for (const stop of documents.values()) stop()
    for (const stop of frames.values()) stop()
    documents.clear(); frames.clear()
  }
}
