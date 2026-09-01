import qq2006HarnessCss from './redesign/qq2006-harness.css?inline'

const QQ2006_HARNESS_STYLE_ID = '@senguoyun/dsh-arkme/qq2006-harness'

let qq2006Selected = false
const listeners = new Set<() => void>()

/** Publish the marketplace's resolved primary-skin state to the iframe owner. */
export function publishQQ2006HarnessSkin(selected: boolean): void {
  qq2006Selected = selected
  for (const listener of listeners) listener()
}

export function qq2006HarnessSkinSelected(): boolean {
  return qq2006Selected
}

export function subscribeQQ2006HarnessSkin(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Apply or retract the adapter inside one already-loaded Harness document. */
export function applyQQ2006HarnessSkinToDocument(
  documentRef: Document,
  selected: boolean,
): void {
  const body = documentRef.body
  if (selected) {
    body.dataset.arkmeSkin = 'qq2006'
    body.setAttribute('data-ds-skin', 'qq2006')
    let style = documentRef.querySelector<HTMLStyleElement>(
      `style[data-plugin-css="${QQ2006_HARNESS_STYLE_ID}"]`,
    )
    if (style === null) {
      style = documentRef.createElement('style')
      style.dataset.plugin = '@senguoyun/dsh-arkme'
      style.dataset.pluginCss = QQ2006_HARNESS_STYLE_ID
      documentRef.head.append(style)
    }
    if (style.textContent !== qq2006HarnessCss) style.textContent = qq2006HarnessCss
    return
  }

  if (body.dataset.arkmeSkin === 'qq2006') delete body.dataset.arkmeSkin
  if (body.getAttribute('data-ds-skin') === 'qq2006') body.removeAttribute('data-ds-skin')
  documentRef.querySelector<HTMLStyleElement>(
    `style[data-plugin-css="${QQ2006_HARNESS_STYLE_ID}"]`,
  )?.remove()
}

/** Same-origin boundary wrapper. A future external URL fails closed. */
export function applyQQ2006HarnessSkinToFrame(
  frame: HTMLIFrameElement,
  selected: boolean,
): boolean {
  try {
    const frameDocument = frame.contentDocument
    if (frameDocument === null || frameDocument.body === null || frameDocument.head === null) return false
    applyQQ2006HarnessSkinToDocument(frameDocument, selected)
    return true
  } catch {
    return false
  }
}
