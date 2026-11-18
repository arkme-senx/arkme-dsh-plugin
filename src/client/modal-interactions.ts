import css from './modal-interactions.css?inline'

/** Install in each product document, including embedded Harness and pop-outs. */
export function installModalInteractions(doc: Document = document): () => void {
  const id = '@senguoyun/dsh-arkme/modal-interactions'
  if (doc.querySelector(`style[data-plugin-css="${id}"]`)) return () => {}
  const style = doc.createElement('style')
  style.dataset.pluginCss = id
  style.textContent = css
  doc.head.append(style)
  return () => style.remove()
}
