/** Private presentation bridge that lets every trigger open the one self-topic menu owner. */
export const SELF_TOPIC_MENU_OPEN = 'arkme:self-topic-menu-open'
export const SELF_TOPIC_MENU_CLOSE = 'arkme:self-topic-menu-close'
export const SELF_TOPIC_MENU_POSITION = 'arkme:self-topic-menu-position'

export interface SelfTopicMenuAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

export interface SelfTopicMenuRequest {
  accepted: boolean
  focusMenu: boolean
  anchor(): SelfTopicMenuAnchor
  keepOpen(): void
  scheduleClose(): void
  onClose(focus: boolean): void
  onSelect(): void
}
