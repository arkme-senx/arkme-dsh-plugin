export interface ArkmeEmojiSeed {
  id: string
  unicode: string
  label: string
}

/** Asset-free emoji catalog shared by Browser UI and Host notification text. */
export const arkmeDefaultEmojiSeeds: readonly ArkmeEmojiSeed[] = Object.freeze([
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

export const arkmeEmojiTokenPattern = /\[(?:jm_emoji|im_emoji):([a-z0-9_]+)\]/gu

const arkmeEmojiUnicodeById: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  arkmeDefaultEmojiSeeds.map(emoji => [emoji.id, emoji.unicode]),
))

export function arkmeHasKnownEmojiToken(value: string): boolean {
  if (value === '' || !value.includes('_emoji:')) return false
  for (const match of value.matchAll(arkmeEmojiTokenPattern)) {
    if (arkmeEmojiUnicodeById[match[1] ?? ''] !== undefined) return true
  }
  return false
}

export function arkmeEmojiTokenSafePrefix(value: string, maxCodePoints: number): string {
  const codePoints = [...value]
  if (maxCodePoints <= 0 || codePoints.length <= maxCodePoints) return maxCodePoints <= 0 ? '' : value
  const prefix = codePoints.slice(0, maxCodePoints).join('')
  let endOffset = prefix.length
  for (const match of value.matchAll(arkmeEmojiTokenPattern)) {
    if (match.index < endOffset && endOffset < match.index + match[0].length) {
      endOffset = match.index
      break
    }
  }
  return value.slice(0, endOffset)
}

/** Known chat emoji tokens become Unicode; unknown and malformed tokens stay intact. */
export function arkmeEmojiPlainText(value: string): string {
  if (value === '' || !value.includes('_emoji:')) return value
  return value.replace(arkmeEmojiTokenPattern, (token, emojiId: string) => arkmeEmojiUnicodeById[emojiId] ?? token)
}
