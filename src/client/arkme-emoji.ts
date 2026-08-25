import { arkmeEmojiAssetUrls } from './arkme-emoji-assets.js'

export interface ArkmeEmoji {
  assetIndex: number
  id: string
  token: string
  unicode: string
  label: string
  assetUrl: string
}

type ArkmeEmojiSeed = Pick<ArkmeEmoji, 'id' | 'unicode' | 'label'>

/** The desktop client's default catalog in the exact asset order used by the message protocol. */
const arkmeDefaultEmojiSeeds: readonly ArkmeEmojiSeed[] = Object.freeze([
  { id: 'angry_face', unicode: '😡', label: '生气' },
  { id: 'awkward_face', unicode: '😐', label: '尴尬' },
  { id: 'heart_eyes', unicode: '😍', label: '喜欢' },
  { id: 'smiling_face', unicode: '😊', label: '开心' },
  { id: 'squint_tongue', unicode: '😝', label: '吐舌' },
  { id: 'yelling_face', unicode: '😣', label: '崩溃' },
  { id: 'sweat_smile', unicode: '😅', label: '汗笑' },
  { id: 'grinning_face', unicode: '😁', label: '呲牙' },
  { id: 'side_eye_smirk', unicode: '😏', label: '坏笑' },
  { id: 'joy_face', unicode: '😂', label: '笑哭' },
  { id: 'unamused_face', unicode: '🙄', label: '无语' },
  { id: 'disappointed_face', unicode: '😔', label: '失落' },
  { id: 'surprised_face', unicode: '😮', label: '惊讶' },
  { id: 'teary_face', unicode: '😢', label: '委屈' },
  { id: 'annoyed_face', unicode: '😒', label: '不爽' },
  { id: 'kiss_heart', unicode: '😘', label: '飞吻' },
  { id: 'yummy_face', unicode: '😋', label: '馋了' },
  { id: 'goofy_grin', unicode: '🤪', label: '搞怪' },
  { id: 'shouting_face', unicode: '😫', label: '抓狂' },
  { id: 'speechless_sweat', unicode: '😓', label: '冒汗' },
  { id: 'cute_face', unicode: '🥹', label: '可爱' },
  { id: 'relaxed_face', unicode: '😌', label: '放松' },
  { id: 'wink_tongue', unicode: '😜', label: '眨眼' },
  { id: 'nauseated_face', unicode: '🤢', label: '恶心' },
  { id: 'sleeping_face', unicode: '😴', label: '睡觉' },
  { id: 'sleepy_face', unicode: '😪', label: '犯困' },
  { id: 'groggy_face', unicode: '😩', label: '困顿' },
  { id: 'crying_face', unicode: '😭', label: '大哭' },
  { id: 'disgusted_face', unicode: '😖', label: '难受' },
  { id: 'shocked_face', unicode: '😱', label: '吓到' },
  { id: 'star_struck_face', unicode: '🤩', label: '星星眼' },
  { id: 'yawning_face', unicode: '🥱', label: '打哈欠' },
  { id: 'sobbing_face', unicode: '😭', label: '暴哭' },
  { id: 'frustrated_face', unicode: '😣', label: '憋屈' },
  { id: 'excited_face', unicode: '😛', label: '兴奋' },
  { id: 'sick_face', unicode: '😨', label: '慌张' },
  { id: 'worried_face', unicode: '😟', label: '担心' },
  { id: 'kiss_sweat_face', unicode: '😗', label: '亲亲' },
  { id: 'speechless_face', unicode: '😑', label: '无话可说' },
  { id: 'masked_face', unicode: '😷', label: '戴口罩' },
  { id: 'stunned_face', unicode: '😳', label: '呆住' },
  { id: 'green_shock_face', unicode: '🤢', label: '反胃' },
  { id: 'silent_face', unicode: '😶', label: '沉默' },
  { id: 'yawn_face', unicode: '🥱', label: '困了' },
  { id: 'pleading_face', unicode: '🥺', label: '求求' },
  { id: 'dizzy_face', unicode: '😵', label: '晕了' },
  { id: 'red_angry_face', unicode: '😠', label: '发火' },
  { id: 'queasy_face', unicode: '🤮', label: '想吐' },
  { id: 'ok_hand', unicode: '👌', label: 'OK' },
  { id: 'thumb_up', unicode: '👍', label: '赞' },
  { id: 'thanks_hands', unicode: '🙏', label: '感谢' },
  { id: 'fist', unicode: '👊', label: '拳头' },
  { id: 'handshake', unicode: '🤝', label: '握手' },
  { id: 'thumb_down', unicode: '👎', label: '弱' },
  { id: 'victory_hand', unicode: '✌️', label: '胜利' },
  { id: 'fist_salute', unicode: '🙏', label: '抱拳' },
])

export const arkmeDefaultEmojis: readonly ArkmeEmoji[] = Object.freeze(arkmeDefaultEmojiSeeds.map((emoji, index) => ({
  ...emoji,
  assetIndex: index + 1,
  token: `[jm_emoji:${emoji.id}]`,
  assetUrl: arkmeEmojiAssetUrls[index]!,
})))

export const arkmeEmojiById: Readonly<Record<string, ArkmeEmoji>> = Object.freeze(Object.fromEntries(
  arkmeDefaultEmojis.map(emoji => [emoji.id, emoji]),
))

const arkmeEmojiTokenPattern = /\[(?:jm_emoji|im_emoji):([a-z0-9_]+)\]/gu

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

/** Mirrors the mobile client's plain-text fallback: known tokens render as emoji and unknown tokens remain intact. */
export function arkmeEmojiPlainText(value: string): string {
  if (value === '' || !value.includes('_emoji:')) return value
  return value.replace(arkmeEmojiTokenPattern, (token, emojiId: string) => arkmeEmojiById[emojiId]?.unicode ?? token)
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
