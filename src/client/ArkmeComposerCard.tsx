import { forwardRef, type HTMLAttributes } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeConversationComposerBorder, arkmeConversationComposerFocusStyle, arkmeConversationComposerLayout } from './conversation-composer-presentation.js'

/** Shared input shell for personal conversations and World publication. */
export const ArkmeComposerCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  focused: boolean; hasTarget?: boolean; highlighted?: boolean; borderColor?: string
}>(function ArkmeComposerCard({ focused, hasTarget = false, highlighted = false, borderColor = arkmeTheme.border, style, ...props }, ref) {
  return <div {...props} ref={ref} data-arkme-primary-composer="true" data-arkme-composer-focused={focused ? 'true' : 'false'}
    style={{ ...arkmeConversationComposerLayout.composerInner, cursor: 'text', transition: 'background-color 140ms ease', ...style,
      ...arkmeConversationComposerFocusStyle(focused), ...arkmeConversationComposerBorder(focused || hasTarget ? borderColor : 'transparent', hasTarget, highlighted) }} />
})
