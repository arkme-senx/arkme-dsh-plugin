import { describe, expect, it } from 'vitest'
import {
  buildWorldVoiceprintInviteMessage,
  WORLD_VOICEPRINT_INVITE_VARIANT_COUNT,
} from '../src/world-voiceprint-copy.js'

describe('World voiceprint invitation copy', () => {
  it('anchors the private message to the referenced World post before the personalized invitation', () => {
    const message = buildWorldVoiceprintInviteMessage({
      peerDisplayName: '小林',
      textPreview: '在海边走了很久，傍晚的风景特别安静。',
      imageCount: 5,
      inviteUrl: 'https://example.test/app/voiceprint/invite#t=token',
      variantIndex: 0,
    })

    expect(message).toContain('小林，我是看到你在世界发的这条快记才来找你的')
    expect(message).toContain('【来自世界的快记】')
    expect(message).toContain('“在海边走了很久，傍晚的风景特别安静。”')
    expect(message).toContain('（还包含5张图片）')
    expect(message).toContain('特别有画面感')
    expect(message).toContain('录入一下声纹')
    expect(message).toContain('https://example.test/app/voiceprint/invite#t=token')
  })

  it('rotates complete content-aware styles instead of repeating one template', () => {
    const messages = Array.from({ length: WORLD_VOICEPRINT_INVITE_VARIANT_COUNT }, (_value, variantIndex) => (
      buildWorldVoiceprintInviteMessage({
        peerDisplayName: '阿七',
        textPreview: '这个想法不能只看结果，我觉得过程也很重要。',
        inviteUrl: 'https://example.test/invite',
        variantIndex,
      })
    ))

    expect(new Set(messages).size).toBe(WORLD_VOICEPRINT_INVITE_VARIANT_COUNT)
    for (const message of messages) {
      expect(message).toContain('“这个想法不能只看结果，我觉得过程也很重要。”')
      expect(message).toContain('声纹')
      expect(message).toContain('https://example.test/invite')
    }
  })

  it('keeps media-only posts identifiable without fabricating text', () => {
    const message = buildWorldVoiceprintInviteMessage({
      peerDisplayName: '这位用户',
      imageCount: 3,
      videoCount: 1,
      inviteUrl: 'https://example.test/invite',
      variantIndex: 2,
    })

    expect(message).toContain('我是看到你在世界发的这条快记才来找你的')
    expect(message).toContain('（你发布了一条3张图片、1段视频的世界快记）')
    expect(message).not.toContain('这位用户，')
  })
})
