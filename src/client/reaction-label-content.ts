import { arkmeDefaultEmojiSeeds } from '../arkme-emoji-text.js'

export const reactionHandIds = ['ok_hand', 'thumb_up', 'thanks_hands', 'fist', 'handshake', 'thumb_down', 'victory_hand', 'fist_salute'] as const
export function reactionEmojiToken(id: string, handId?: string) {
  return handId ? `[jm_combo:${id}:${handId}]` : `[jm_emoji:${id}]`
}
export function reactionLabelContent(label: string) {
  const match = /^\[jm_combo:([a-z0-9_]+):([a-z0-9_]+)\](?= |$)/u.exec(label)
  if (match) {
    const main = arkmeDefaultEmojiSeeds.find(value => value.id === match[1])
    const hand = arkmeDefaultEmojiSeeds.find(value => value.id === match[2] && reactionHandIds.some(id => id === value.id))
    if (!main || !hand) return undefined
    return { id: main.id, name: main.label, handId: hand.id, handName: hand.label, token: match[0], text: label.slice(match[0].length).trimStart() }
  }
  const emoji = arkmeDefaultEmojiSeeds.find(value => label === `[jm_emoji:${value.id}]` || label.startsWith(`[jm_emoji:${value.id}] `))
  if (!emoji) return undefined
  const token = `[jm_emoji:${emoji.id}]`
  return { id: emoji.id, name: emoji.label, token, text: label.slice(token.length).trimStart() }
}
export function reactionLabelLength(label: string) {
  const content = reactionLabelContent(label)
  return content ? 1 + (content.text ? 1 + content.text.length : 0) : label.length
}
export function normalizeReactionLabel(label: string) {
  label = label.trim()
  const content = reactionLabelContent(label)
  if (!content) return label.slice(0, 20)
  const text = content.text.slice(0, 18).trimEnd()
  return content.token + (text ? ` ${text}` : '')
}
