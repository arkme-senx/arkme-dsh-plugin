import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { CONVERSATION_REMOVAL_COLLAPSE_MS, type ConversationRemovalPhase } from './use-conversation-removal-feedback.js'

const transition = `${CONVERSATION_REMOVAL_COLLAPSE_MS}ms ease`
export function conversationRemovalRowStyle(phase: ConversationRemovalPhase | undefined): CSSProperties {
  if (phase === undefined) return {}
  return {
    transition: `height ${transition}, min-height ${transition}, padding ${transition}, margin ${transition}, opacity ${transition}`,
    ...(phase === 'collapsing' ? { height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0, opacity: 0, overflow: 'hidden' } : {}),
  }
}

export function ArkmeConversationRemovalStyles() {
  return <style>{`
    [data-arkme-removal-phase] > :not([data-arkme-removal-overlay]) {
      transition: opacity ${transition}, transform ${transition};
    }
    [data-arkme-removal-phase="accepted"] > :not([data-arkme-removal-overlay]),
    [data-arkme-removal-phase="collapsing"] > :not([data-arkme-removal-overlay]) {
      opacity: 0; transform: translateX(-8%); pointer-events: none;
    }
    [data-arkme-removal-overlay] { animation: arkme-removal-feedback ${transition}; }
    @keyframes arkme-removal-feedback { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      [data-arkme-removal-phase], [data-arkme-removal-phase] > * {
        transition: none !important; animation: none !important;
      }
    }
  `}</style>
}

export function ArkmeConversationRemovalFeedback({ phase }: { phase: ConversationRemovalPhase | undefined }) {
  if (phase === undefined || phase === 'pending') return null
  return <span data-arkme-removal-overlay role="status" aria-live="polite" style={{
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 12px', borderRadius: 'inherit', background: arkmeTheme.layer2, color: arkmeTheme.secondary,
    fontSize: 12, lineHeight: '18px', pointerEvents: 'none', overflow: 'hidden',
  }}>已移除对话，可在联系人中找回</span>
}
