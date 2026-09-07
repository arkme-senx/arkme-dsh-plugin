import { arkmeEmojiAssetUrls } from './arkme-emoji-assets.js'
import { arkmeDefaultEmojiSeeds, arkmeEmojiTokenPattern } from '../arkme-emoji-text.js'

export {
  arkmeDefaultEmojiSeeds,
  arkmeEmojiPlainText,
  arkmeEmojiTokenSafePrefix,
  arkmeHasKnownEmojiToken,
} from '../arkme-emoji-text.js'

export interface ArkmeEmoji {
  assetIndex: number
  id: string
  token: string
  unicode: string
  label: string
  assetUrl: string
}

export const arkmeDefaultEmojis: readonly ArkmeEmoji[] = Object.freeze(arkmeDefaultEmojiSeeds.map((emoji, index) => ({
  ...emoji,
  assetIndex: index + 1,
  token: `[jm_emoji:${emoji.id}]`,
  assetUrl: arkmeEmojiAssetUrls[index]!,
})))

export const arkmeEmojiById: Readonly<Record<string, ArkmeEmoji>> = Object.freeze(Object.fromEntries(
  arkmeDefaultEmojis.map(emoji => [emoji.id, emoji]),
))

export interface ArkmeEmojiTextRun {
  kind: 'text' | 'emoji'
  text: string
  emoji?: ArkmeEmoji
}

export function arkmeEmojiTextRuns(value: string): ArkmeEmojiTextRun[] {
  const runs: ArkmeEmojiTextRun[] = []
  let cursor = 0
  for (const match of value.matchAll(arkmeEmojiTokenPattern)) {
    const emoji = arkmeEmojiById[match[1] ?? '']
    if (emoji === undefined || match.index === undefined) continue
    if (match.index > cursor) runs.push({ kind: 'text', text: value.slice(cursor, match.index) })
    runs.push({ kind: 'emoji', text: match[0], emoji })
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) runs.push({ kind: 'text', text: value.slice(cursor) })
  return runs.length === 0 && value !== '' ? [{ kind: 'text', text: value }] : runs
}

export interface ArkmeEmojiInsertion {
  text: string
  caretIndex: number
}

/** Inserts the desktop client's portable rich-emoji token at the native selection. */
export function insertArkmeEmojiAtSelection(
  text: string,
  emoji: Pick<ArkmeEmoji, 'token'>,
  selectionStart: number,
  selectionEnd = selectionStart,
  maxLength = 20_000,
): ArkmeEmojiInsertion | undefined {
  const start = Math.max(0, Math.min(text.length, Math.trunc(selectionStart)))
  const end = Math.max(start, Math.min(text.length, Math.trunc(selectionEnd)))
  const nextText = text.slice(0, start) + emoji.token + text.slice(end)
  if (nextText.length > maxLength) return undefined
  return { text: nextText, caretIndex: start + emoji.token.length }
}

export function nextArkmeRecentEmojiIds(
  current: readonly string[],
  emojiId: string,
  maxCount = 8,
): string[] {
  if (arkmeEmojiById[emojiId] === undefined || maxCount <= 0) return current.slice(0, Math.max(0, maxCount))
  return [emojiId, ...current.filter(id => id !== emojiId && arkmeEmojiById[id] !== undefined)].slice(0, maxCount)
}
