import { watchConversationMenuHover } from './conversation-menu-layer.js'
import { SELF_TOPIC_MENU_CLOSE, SELF_TOPIC_MENU_OPEN, SELF_TOPIC_MENU_POSITION, type SelfTopicMenuRequest } from './self-topic-menu-bridge.js'

/** Only the topic-list bridge is specific; the hover lifecycle is shared with DSH. */
export function watchSelfTopicMenuHover(anchor: HTMLElement, activate: () => void): () => void {
  const doc = anchor.ownerDocument, win = doc.defaultView
  if (!win) return () => {}
  return watchConversationMenuHover(anchor, {
    open: hover => {
      const request: SelfTopicMenuRequest = { ...hover, accepted: false, onSelect: activate }
      doc.dispatchEvent(new win.CustomEvent(SELF_TOPIC_MENU_OPEN, { detail: request }))
      return request.accepted
    },
    close: () => doc.dispatchEvent(new win.CustomEvent(SELF_TOPIC_MENU_CLOSE)),
    position: () => doc.dispatchEvent(new win.CustomEvent(SELF_TOPIC_MENU_POSITION)),
    contains: target => target instanceof win.Element && target.closest('[data-arkme-self-topic-menu], [role="menu"], [role="dialog"], [role="alertdialog"]') !== null,
  })
}
