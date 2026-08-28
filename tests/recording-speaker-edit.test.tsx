import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'

describe('recording speaker editor', () => {
  it('offers new-speaker and bounded same-speaker batch controls without an unsupported unassign action', () => {
    const markup = renderToStaticMarkup(<ArkmeRecordingSpeakerEditor item={{
      itemId: 'item-1', itemRef: 'sealed-item', speakerLabel: '说话人 1', speakerColorIndex: 1,
      speakerIdentity: 'session-1:1', sameSpeakerItemCount: 3, text: '内容',
      startAtMillis: 1_000, endAtMillis: 2_000, isBackground: false,
    }} onUpdated={() => {}} onClose={() => {}} />)
    expect(markup).toContain('编辑“说话人 1”')
    expect(markup).toContain('新说话人名称')
    expect(markup).toContain('批量修改当前录音 3 处')
    expect(markup).not.toContain('解绑')
  })
})
