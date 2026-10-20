import type { CSSProperties } from 'react'

const arkmeConversationComposerMaxHeight = 336

/** Keep each border property present across target and resize transitions. */
export function arkmeConversationComposerBorder(color: string, hasTarget: boolean, highlighted: boolean): CSSProperties {
  return {
    borderStyle: 'solid',
    borderColor: highlighted ? '#09B83E' : color,
    borderTopWidth: hasTarget && !highlighted ? 0 : 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRadius: highlighted ? 12 : hasTarget ? '0 0 15px 15px' : 15,
  }
}

export function arkmeConversationComposerFocusStyle(focused: boolean): CSSProperties {
  return {
    background: focused ? 'var(--arkme-primary-composer-focused, #ffffff)' : 'var(--arkme-primary-composer-idle, #f6f6f6)',
    boxShadow: 'none',
  }
}

/** Shared size and layout contract for Arkme chat composers. Interaction stays with each surface. */
export const arkmeConversationComposerLayout = {
  composer: {
    flex: 'none', display: 'flex', justifyContent: 'stretch', padding: '0 24px 20px',
  },
  composerStack: { width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', containerType: 'inline-size', containerName: 'arkme-composer' },
  composerInner: {
    position: 'relative', width: '100%', overflow: 'visible', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 13px 9px', borderRadius: 15,
  },
  textarea: {
    width: '100%', minHeight: 38, maxHeight: arkmeConversationComposerMaxHeight,
    resize: 'none', overflowY: 'auto', boxSizing: 'border-box', border: 0, outline: 0, padding: 0,
    fontFamily: 'var(--dsw-font-family, inherit)', fontSize: 13, lineHeight: '21px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere',
  },
  tools: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, minWidth: 0, padding: 0,
  },
} satisfies Record<'composer' | 'composerStack' | 'composerInner' | 'textarea' | 'tools', CSSProperties>

export function arkmeConversationComposerHeight(scrollHeight: number): number {
  return Math.min(scrollHeight, arkmeConversationComposerMaxHeight)
}
