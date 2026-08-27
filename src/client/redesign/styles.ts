import redesignCss from './arkme-redesign.css?inline'

const REDESIGN_STYLE_ID = '@senguoyun/dsh-arkme/redesign'

/** Install the Arkme visual system independently of whichever DSH seat is active. */
export function installArkmeRedesignStyles(): () => void {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${REDESIGN_STYLE_ID}"]`)
  if (existing !== null) {
    existing.textContent = redesignCss
    return () => undefined
  }
  const style = document.createElement('style')
  style.dataset.plugin = '@senguoyun/dsh-arkme'
  style.dataset.pluginCss = REDESIGN_STYLE_ID
  style.textContent = redesignCss
  document.head.append(style)
  return () => { style.remove() }
}
