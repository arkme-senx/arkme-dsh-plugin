import redesignBaseCss from './arkme-redesign.css?inline'
import buttonHoverCss from '../arkme-button-hover.css?inline'
import interactionFeedbackCss from './interaction-feedback.css?inline'
import membershipCss from '../arkme-membership.css?inline'
import recordingBreathCss from '../recordings/recording-breath.css?inline'
import { ARKME_NAVIGATION_WIDTH } from '../arkme-layout.js'

const layoutCss = `:root { --arkme-navigation-width: ${ARKME_NAVIGATION_WIDTH}px; }\n${redesignBaseCss}\n${buttonHoverCss}\n${interactionFeedbackCss}\n${membershipCss}\n${recordingBreathCss}`

const REDESIGN_STYLE_ID = '@senguoyun/dsh-arkme/redesign'

/** Install the Arkme visual system independently of whichever DSH seat is active. */
export function installArkmeRedesignStyles(): () => void {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${REDESIGN_STYLE_ID}"]`)
  if (existing !== null) {
    existing.textContent = layoutCss
    return () => undefined
  }
  const style = document.createElement('style')
  style.dataset.plugin = '@senguoyun/dsh-arkme'
  style.dataset.pluginCss = REDESIGN_STYLE_ID
  style.textContent = layoutCss
  document.head.append(style)
  return () => { style.remove() }
}
