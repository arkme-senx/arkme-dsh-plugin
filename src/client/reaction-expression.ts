import type { ReactionExpression } from '../reaction-contract.js'
import { reactionLabelContent, reactionEmojiToken } from './reaction-label-content.js'
import { phraseColor } from './reaction-phrase-palette.js'

export function expressionLabel(expression: ReactionExpression): string {
  return [expression.emoji ? reactionEmojiToken(expression.emoji, expression.hand) : '', expression.text].filter(Boolean).join(' ')
}
export function labelExpression(label: string, color?: string): ReactionExpression {
  const content = reactionLabelContent(label)
  return content
    ? { text: content.text, emoji: content.id, ...(content.handId ? { hand: content.handId } : {}), ...(content.text || color ? { color: phraseColor(label, color).id } : {}) }
    : { text: label.trim(), color: phraseColor(label, color).id }
}

// Labels are presentation only: color is part of the saved expression identity.
export function expressionIdentity(expression: ReactionExpression): string {
  return JSON.stringify([expression.text, expression.emoji ?? '', expression.hand ?? '', expression.color ?? ''])
}
