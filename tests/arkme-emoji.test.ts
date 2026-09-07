import { describe, expect, it } from 'vitest'
import { arkmeEmojiPlainText as clientArkmeEmojiPlainText } from '../src/client/arkme-emoji.js'
import { arkmeEmojiPlainText } from '../src/arkme-emoji-text.js'

describe('Jotmo emoji plain-text rendering', () => {
  it('matches the mobile fallback for known current and legacy tokens', () => {
    expect(arkmeEmojiPlainText('喜欢[jm_emoji:heart_eyes][im_emoji:thumb_up]')).toBe('喜欢😍👍')
    expect(arkmeEmojiPlainText('[jm_emoji:angry_face][jm_emoji:fist_salute]')).toBe('😡🙏')
    expect(clientArkmeEmojiPlainText).toBe(arkmeEmojiPlainText)
  })

  it('keeps unknown and malformed tokens intact', () => {
    expect(arkmeEmojiPlainText('保留[jm_emoji:not_exists]和[jm_emoji:HEART]')).toBe('保留[jm_emoji:not_exists]和[jm_emoji:HEART]')
  })
})
