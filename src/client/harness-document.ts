import { HARNESS_DOCUMENT_STARTED } from '../harness-embed-contract.js'

/** Observe each new same-origin document before window.load's subresource barrier. */
export function watchHarnessDocument(frame: HTMLIFrameElement, onDocument: (document: Document) => void): () => void {
  const win = frame.ownerDocument.defaultView!
  let current: Document | null = null
  const attach = () => {
    let next: Document | null
    try { next = frame.contentDocument } catch { return }
    if (!next?.documentElement || next === current) return
    current = next
    onDocument(next)
  }
  const started = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== win.location.origin
      || event.data?.type !== HARNESS_DOCUMENT_STARTED) return
    attach()
  }
  win.addEventListener('message', started)
  frame.addEventListener('load', attach)
  attach()
  return () => {
    win.removeEventListener('message', started)
    frame.removeEventListener('load', attach)
  }
}
