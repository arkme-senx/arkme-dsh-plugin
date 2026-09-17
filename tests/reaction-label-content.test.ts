import { describe, expect, it } from 'vitest'
import { normalizeReactionLabel, reactionLabelContent, reactionLabelLength } from '../src/client/reaction-label-content.js'

describe('composite reaction labels', () => {
  it('preserves a whole composition while limiting its visible text', () => {
    const token = '[jm_combo:smiling_face:thumb_up]'
    expect(reactionLabelLength(token)).toBe(1)
    expect(reactionLabelContent(token + ' 稳了')).toMatchObject({ id: 'smiling_face', handId: 'thumb_up', text: '稳了' })
    expect(normalizeReactionLabel(token + ' ' + '字'.repeat(30))).toBe(token + ' ' + '字'.repeat(18))
    expect(reactionLabelLength(normalizeReactionLabel(token + ' ' + '字'.repeat(30)))).toBe(20)
  })
  it('recognizes only available assets and supported accessories, preserving old labels', () => {
    expect(reactionLabelContent('[jm_combo:missing:thumb_up]')).toBeUndefined()
    expect(reactionLabelContent('[jm_combo:smiling_face:missing]')).toBeUndefined()
    expect(reactionLabelContent('[jm_combo:smiling_face:angry_face]')).toBeUndefined()
    expect(reactionLabelContent('[jm_emoji:smiling_face] 你好')).toMatchObject({ id: 'smiling_face', text: '你好' })
    expect(normalizeReactionLabel('👌 收到')).toBe('👌 收到')
  })
})
