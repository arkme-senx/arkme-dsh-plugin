import { describe, expect, it } from 'vitest'
import { arkmeEmojiPlainText as clientArkmeEmojiPlainText, arkmeEmojiById, nextArkmeRecentEmojiIds } from '../src/client/arkme-emoji.js'
import { arkmeEmojiPlainText, arkmeEmojiTokenSafePrefix, arkmeEmojiClippedText } from '../src/arkme-emoji-text.js'

describe('Jotmo emoji plain-text rendering', () => {
  it('matches the mobile fallback for known current and legacy tokens', () => {
    expect(arkmeEmojiPlainText('喜欢[jm_emoji:heart_eyes][im_emoji:thumb_up]')).toBe('喜欢😍👍')
    expect(arkmeEmojiPlainText('[jm_emoji:angry_face][jm_emoji:fist_salute]')).toBe('😡🙏')
    expect(clientArkmeEmojiPlainText).toBe(arkmeEmojiPlainText)
  })

  it('keeps unknown and malformed tokens intact', () => {
    expect(arkmeEmojiPlainText('[jm_emoji:constructor]')).toBe('[jm_emoji:constructor]')
    expect(arkmeEmojiPlainText('保留[jm_emoji:not_exists]和[jm_emoji:HEART]')).toBe('保留[jm_emoji:not_exists]和[jm_emoji:HEART]')
  })

  it('does not treat Object prototype keys as catalog entries in the picker', () => {
    for (const id of ['constructor', '__proto__', 'toString']) {
      expect(arkmeEmojiById[id]).toBeUndefined()
      expect(nextArkmeRecentEmojiIds(['thumb_up'], id)).toEqual(['thumb_up'])
    }
  })

  it('clips content without splitting current, legacy or unknown tokens', () => {
    for (const token of ['[jm_emoji:heart_eyes]', '[im_emoji:thumb_up]', '[jm_emoji:unknown]', '[jm_emoji:constructor]']) {
      const text = `前${token}后`
      for (let limit = 2; limit < token.length + 1; limit++) {
        expect(arkmeEmojiTokenSafePrefix(text, limit)).toBe('前')
        expect(arkmeEmojiClippedText(text, limit)).toBe('前…[已截断]')
      }
      expect(arkmeEmojiClippedText(text, text.length)).toBe(text)
    }
  })

  it('preserves graphemes and existing code-point versus UTF-16 response budgets', () => {
    for (const grapheme of ['👨‍👩‍👧‍👦', '👍🏽', '🇨🇳', '✌️', 'e\u0301']) {
      for (let limit = 1; limit < [...grapheme].length; limit++) {
        expect(arkmeEmojiTokenSafePrefix(grapheme, limit)).toBe('')
      }
      for (let limit = 1; limit < grapheme.length; limit++) {
        expect(arkmeEmojiClippedText(grapheme, limit)).toBe('…[已截断]')
      }
    }
    expect(arkmeEmojiTokenSafePrefix('😀a', 1)).toBe('😀')
    expect(arkmeEmojiClippedText('😀a', 1)).toBe('…[已截断]')
    expect(arkmeEmojiClippedText(null)).toBe('')
    expect(arkmeEmojiClippedText('  文本  ')).toBe('文本')
    expect(arkmeEmojiTokenSafePrefix('文本', 0)).toBe('')
    const markedToken = '[jm_emoji:heart_eyes]\u0301'
    expect(arkmeEmojiTokenSafePrefix(markedToken, markedToken.length - 1)).toBe('')
  })
})
