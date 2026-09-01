import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'

describe('recording speaker editor', () => {
  it('matches the desktop editor shell and exposes only owner-supported assignment scopes', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSpeakerEditor item={{
      itemId: 'item-1', itemRef: 'sealed-item', speakerLabel: '说话人 1', speakerColorIndex: 1,
      speakerNumber: 1, speakerKey: 'speaker-opaque', sameSpeakerItemCount: 3, text: '内容',
      startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false, isSelf: false,
    }} onUpdated={() => {}} onClose={() => {}} />)
    expect(markup).toContain('width:278px')
    expect(markup).toContain('position:fixed')
    expect(markup).toContain('placeholder="输入名称"')
    expect(markup).toContain('批量修改 3 处“说话人 1”')
    expect(markup).not.toContain('取消当前片段的说话人关联')
  })
})
