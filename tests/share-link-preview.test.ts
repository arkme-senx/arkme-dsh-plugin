import { describe, expect, it } from 'vitest'
import { collectShareLinks, parseShareLink, previewImageUrl, projectSharePreview, sharePreviewIsOwnMessage } from '../src/share-link-preview.js'

const url = 'https://jiwo.cc/s/Abcdef1234567890'
const target = parseShareLink(url)!
describe('internal share recognition and bounded projection', () => {
  it('recognizes Me by the single original record owner, never by nickname or sharer', () => {
    const data = { access_mode: 'normal', items: [{ record_uid: 'record-a', sender_display_name: '同名用户' }],
      source_context: { anchors: [{ record_uid: 'record-a', record_owner_user_id: '42' }] } }
    expect(sharePreviewIsOwnMessage(data, 42)).toBe(true)
    expect(sharePreviewIsOwnMessage(data, 43)).toBe(false)
    expect(sharePreviewIsOwnMessage({ ...data, access_mode: 'link_read_only' }, 42)).toBe(false)
    expect(sharePreviewIsOwnMessage({ ...data, items: [{ record_uid: 'record-b' }] }, 42)).toBe(false)
    expect(sharePreviewIsOwnMessage({ ...data, items: [{}, {}] }, 42)).toBe(false)
    expect(sharePreviewIsOwnMessage({ ...data, items: [{}] }, 42)).toBe(true)
    expect(sharePreviewIsOwnMessage({ ...data, items: [{}], source_context: { anchors: [...data.source_context.anchors, ...data.source_context.anchors] } }, 42)).toBe(false)
    expect(sharePreviewIsOwnMessage({ items: [{ sender_display_name: '我' }], shared_by_user_id: 42 }, 42)).toBe(false)
    for (const item of [{ source_kind: 'agent_message' }, { source_kind: 'dsh_native' }, { source_kind: 'dsh_question' }, { template_kind: 5 }, { structured_content: { structured_kind: 3 } }]) {
      expect(sharePreviewIsOwnMessage({ ...data, items: [{ ...data.items[0], ...item }] }, 42)).toBe(false)
    }
  })
  it.each(['jiwo.cc', 'www.jiwo.cc', 'app.jiwo.cc', 'app.jotmo.cc', 'app.arkme.ai', 'jotmo-app.senguo.me', 'app-test.arkme.ai'])('recognizes verified host %s', host => {
    expect(parseShareLink(`https://${host}/s/Abcdef1234567890`)?.kind).toBe('message')
  })
  it.each(['http://jiwo.cc/s/Abcdef1234567890', 'https://jiwo.cc.evil.com/s/Abcdef1234567890', 'https://jiwo.cc:8443/s/Abcdef1234567890', 'https://u:p@jiwo.cc/s/Abcdef1234567890', `${url}?token=secret`, `${url}#x`, 'https://jiwo.cc/app/audio/long-recording', 'https://jiwo.cc/webhook', 'https://jiwo.cc/api/bot/send', 'https://jiwo.cc/login'])('does not auto-preview %s', raw => {
    expect(parseShareLink(raw)).toBeUndefined()
  })
  it.each([
    ['/app/forward/abc?code=x&s=12', 'conversation'], ['/share/chat/forward/abc', 'conversation'],
    ['/shijie/tison', 'world'], ['/app/shijie/tison/record/record-uid', 'public-record'],
    ['/share/topic/subject?code=x&s=12', 'topic'], [`/share/call/${'a'.repeat(24)}.${'b'.repeat(64)}`, 'call'],
    ['/share-call?token=x', 'call-invite'], ['/v?p=preview#t=binding', 'voiceprint'],
    ['/app/voiceprint/invite#t=secret', 'voiceprint'], ['/app/auto-sticker/invite?a=b', 'auto-sticker'],
    [`/share/extension/extshare_${'a'.repeat(32)}`, 'extension'],
  ])('classifies %s', (path, kind) => expect(parseShareLink(`https://jiwo.cc${path}`)?.kind).toBe(kind))
  it('never includes voiceprint binding secret in its preview identifier', () => {
    expect(parseShareLink('https://jiwo.cc/v?p=preview#t=binding')?.id).toBe('preview')
    expect(parseShareLink('https://jiwo.cc/v#t=binding')?.id).toBe('')
  })
  it('deduplicates normal/markdown links without consuming mixed text', () => {
    expect(collectShareLinks(`${url}  普通文字 ${url}`, 'plain')).toMatchObject({ standalone: false, links: [target] })
    expect(collectShareLinks(`  ${url}\n`, 'plain').standalone).toBe(true)
    expect(collectShareLinks(`[快记](${url})`, 'markdown').standalone).toBe(true)
    expect(collectShareLinks(`[快记](${url}) 后面的文字`, 'markdown').standalone).toBe(false)
    expect(collectShareLinks(`[${url} 后面的文字](${url})`, 'markdown').standalone).toBe(false)
    expect(collectShareLinks(`[说明][note]\n\n[note]: ${url}`, 'markdown').links).toEqual([target])
  })
  it('excludes code, HTML, images, and unused markdown definitions', () => {
    for (const text of ['`' + url + '`', '```\n' + url + '\n```', `<div>${url}</div>`, `![图](${url})`, `[unused]: ${url}`]) {
      expect(collectShareLinks(text, 'markdown').links).toEqual([])
    }
  })
  it('projects the original sender snapshot and plain excerpt, not current user', () => {
    expect(projectSharePreview(target, { items: [{ sender_display_name: '原角色', sender_avatar_url: 'https://cdn.example.com/avatar.png', text_content: '**内容** [链接](https://example.com)', text_format: 'markdown', send_at: 1790000000 }] })).toMatchObject({ kind: 'message', author: '原角色', summary: '内容 链接', timestamp: 1790000000000, avatarUrl: 'https://cdn.example.com/avatar.png' })
    expect(projectSharePreview(target, { items: [{ text_content: '**按原文保留**', text_format: 'plain' }] }).summary).toBe('**按原文保留**')
  })
  it('recognizes a single forwarded bundle as conversation and uses original title', () => {
    const result = projectSharePreview(target, { presentation: [{ kind: 'forward_bundle', title: '项目讨论' }], items: [{ sender_display_name: '小王', text_content: '明天讨论' }] })
    expect(result).toMatchObject({ kind: 'conversation', title: '项目讨论', count: 1, summary: '小王：明天讨论' })
  })
  it('projects multiple records, article, recording and AI without guessing agent name', () => {
    expect(projectSharePreview(target, { items: [{ sender_display_name: 'A', text_content: '甲' }, { sender_display_name: 'B', text_content: '乙' }] })).toMatchObject({ kind: 'conversation', count: 2, summary: 'A：甲\nB：乙' })
    expect(projectSharePreview(target, { items: [{ display_kind: 1, title: '长文标题', text_content: '文章' }] })).toMatchObject({ kind: 'article', title: '长文标题' })
    expect(projectSharePreview(target, { items: [{ structured_content: { structured_kind: 1, duration_millis: 42000, long_recording_segments: [{ speaker_label: '小王', text: '讨论结果' }] } }] })).toMatchObject({ kind: 'recording', summary: '小王：讨论结果', durationMillis: 42000 })
    expect(projectSharePreview(target, { items: [{ source_kind: 'dsh_native', sender_display_name: 'Agent', text_content: '结果' }] })).toMatchObject({ kind: 'agent', author: 'Agent' })
  })
  it.each([[1, 'image'], [2, 'audio'], [3, 'video'], [4, 'file']])('uses real public media kind %s', (file_kind, kind) => {
    expect(projectSharePreview(target, { items: [{ media_items: [{ file_kind, file_name: '媒体名' }] }] })).toMatchObject({ kind, summary: '媒体名' })
  })
  it('does not use original download URLs as thumbnails or allow unsafe image schemes/hosts', () => {
    expect(projectSharePreview(target, { items: [{ media_items: [{ file_kind: 1, download_url: 'https://cdn.example.com/original.jpg' }] }] }).thumbnailUrl).toBeUndefined()
    for (const value of ['http://example.com/x', 'file:///secret', 'javascript:alert(1)', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://user:pass@example.com/x']) expect(previewImageUrl(value)).toBeUndefined()
  })
  it('does not disclose stale content for unavailable/auditing shares', () => {
    for (const [status, expected] of [['reviewing', 'auditing'], ['auditing', 'auditing'], ['expired', 'expired'], ['unavailable', 'unavailable']]) {
      expect(projectSharePreview(target, { status, items: [{ text_content: '不可显示的正文' }] })).toEqual({ kind: 'message', state: expected })
    }
    expect(projectSharePreview(target, {}).state).toBe('unavailable')
  })
})
