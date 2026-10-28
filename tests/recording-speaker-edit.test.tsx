import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'

describe('recording speaker editor', () => {
  it('matches the desktop editor shell and exposes only owner-supported assignment scopes', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSpeakerEditor item={{
      itemId: 'item-1', itemRef: 'sealed-item', speakerLabel: '说话人 1', speakerColorIndex: 1,
      speakerNumber: 1, speakerKey: 'speaker-opaque', canBindSpeaker: true, sameSpeakerItemCount: 3, text: '内容',
      startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
    }} onUpdated={() => {}} onClose={() => {}} />)
    expect(markup).toContain('width:278px')
    expect(markup).toContain('position:fixed')
    expect(markup).toContain('placeholder="输入名称"')
    expect(markup).toContain('当天同组 3 处')
    expect(markup).toContain('仅此片段')
    expect(markup).not.toContain('取消当前片段的说话人关联')
  })

  it('allows the owner-supported flagged-speaker batch scope', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSpeakerEditor item={{
      itemId: 'item-flagged', itemRef: 'sealed-flagged-item', speakerLabel: '已识别说话人', speakerColorIndex: 2,
      speakerNumber: -1, speakerKey: 'formal-speaker-opaque', canBindSpeaker: true, sameSpeakerItemCount: 2, text: '内容',
      startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
    }} onUpdated={() => {}} onClose={() => {}} />)

    expect(markup).toContain('当天同组 2 处')
  })

  it('defaults the timeline entry to the system group without locking the scope', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSpeakerEditor initialBatchUpdate item={{
      itemId: 'item-1', itemRef: 'sealed-item', speakerLabel: '说话人 1', speakerColorIndex: 1,
      speakerNumber: 1, speakerKey: 'speaker-opaque', canBindSpeaker: true, sameSpeakerItemCount: 3, text: '内容',
      startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
    }} onUpdated={() => {}} onClose={() => {}} />)

    expect(markup).toMatch(/aria-pressed="true"[^>]*>当天同组 3 处/)
    expect(markup).toMatch(/aria-pressed="false"[^>]*>仅此片段/)
    expect(markup).toContain('系统分组，可能包含不同的人')
  })
})
