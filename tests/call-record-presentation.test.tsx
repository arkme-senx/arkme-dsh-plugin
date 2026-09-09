import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectCallRecord } from '../src/call-record-presentation.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { arkmeCallRecordBubbleStyle } from '../src/client/ArkmeCallRecordContent.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'

describe('desktop call record presentation', () => {
  it.each(['Audio', 'Video'])('renders cancelled %s with the original desktop styling', media => {
    const callRecord = projectCallRecord({ record: { payload: { content_payload: { crd: { mt: media, rs: 'Cancel', cr: 42, ri: 'private-room', ci: 'private-call' } } } } }, 42)!
    expect(callRecord).toEqual({ mediaType: media.toLowerCase(), text: '已取消' })
    const html = renderToStaticMarkup(<ArkmeMessageContent item={{ itemUid: 'call', senderName: '我', isMe: true, sendAtMillis: 1, title: '', textContent: '', status: 1, callRecord }} />)
    expect(html).toContain('已取消')
    expect(html).toContain('gap:6px')
    expect(html).toContain('font-size:14px')
    expect(html).toContain('width:18px')
    expect(html).not.toContain('暂不支持')
    expect(html).not.toContain('private-room')
    expect(arkmeCallRecordBubbleStyle(true)).toMatchObject({ background: arkmeTheme.messageOwn, borderRadius: '12px 4px 12px 12px', padding: 10, minHeight: 42 })
    expect(arkmeCallRecordBubbleStyle(false).background).toBe(arkmeTheme.messageOther)
    expect(html).toContain('--dsw-alias-label-secondary')
    expect(html).toContain('--dsw-alias-label-tertiary')
  })

  it.each([
    ['Cancel', '已取消', '对方已取消'], ['Reject', '对方已拒绝', '已拒绝'],
    ['NotAnswer', '对方无应答', '未接听'], ['CallBusy', '对方忙线中', '未接听(忙线)'],
    ['Offline', '对方离线', '未接听(离线)'],
  ])('preserves caller/viewer wording for %s', (rs, own, other) => {
    const raw = { extra: JSON.stringify({ type: 'call_record', mt: 'Audio', rs, cr: 42 }) }
    expect(projectCallRecord(raw, 42)?.text).toBe(own)
    expect(projectCallRecord(raw, 7)?.text).toBe(other)
  })

  it('supports record-service payloads and connected duration without calling them cancelled', () => {
    const raw = { record_core: { content_payload: { call_record: { media_type: 'Video', call_result: 'NormalEnd', caller_id: 42, duration_sec: 65 } } } }
    expect(projectCallRecord(raw, 42)).toEqual({ mediaType: 'video', text: '视频通话 01:05' })
    expect(projectCallRecord({ crd: { mt: 'Audio', rs: 'NormalEnd', du: 0 } }, 42)?.text).toBe('语音通话，未接通')
  })

  it('does not misclassify regular content or invent missing call status', () => {
    expect(projectCallRecord({ content_payload: { media_refs: [{ duration: 60 }] } }, 42)).toBeUndefined()
    expect(projectCallRecord({ template_kind: 5, structured_anchor: { anchor_kind: 2 } }, 42)).toBeUndefined()
    expect(projectCallRecord({ crd: { mt: 'Audio', rs: 'future-result' } }, 42)?.text).toBe('语音通话')
    expect(projectCallRecord({ extra: '{invalid' }, 42)).toBeUndefined()
  })
})
