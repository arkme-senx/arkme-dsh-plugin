import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatService } from '../src/services/chat-service.js'
import { ForwardRecordsDetail } from '../src/client/ArkmeNoteDetails.js'
import type { ArkmeTimelineItem } from '../src/types.js'

describe('native forward receiver presentation', () => {
  it.each([0, undefined])('uses the explicit AI asset with sender %s, not content ownership or identity prefixes', async sender => {
    const profile = { sealProfileImageRef: vi.fn(async () => 'user-avatar') }
    const media = { recordContentPayload: (raw: unknown) => raw, forwardContentBlocks: () => [] }
    const reader = new ChatService({} as never, {} as never, profile as never, media as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const base = { source_type: 'agent', source_sender_user_id: sender, owner_id: 42, owner_name: '内容拥有者', source_display_name: 'DeepSeek Harness', source_avatar_kind: 'deepseek', render_format: 'markdown', text_format: 'plain', text: '    code_block()\n\n', send_at: 1000 }
    const forward = await reader.chatForwardRecordsPreview({ forward_records: { render_kind: 'forward_records', items: [
      base, { ...base, source_sender_user_id: 42 }, { ...base, source_type: 'record' },
      { ...base, source_avatar_kind: undefined, source_identity_id: 'dsh:hash' },
    ] } }, 42, 1000)
    expect(forward?.items[0]).toMatchObject({ senderName: 'DeepSeek Harness', avatarKind: 'deepseek' })
    expect(forward?.items[0]?.avatarRef).toBeUndefined()
    expect(forward?.items[0]?.textFormat).toBe('markdown')
    expect(forward?.items[0]?.textContent).toBe(base.text)
    expect(forward?.items[2]?.textFormat).toBe('plain')
    expect(forward?.items.slice(1).every(item => item.avatarKind === undefined)).toBe(true)
    expect(forward?.items[1]).toMatchObject({ senderName: '内容拥有者', avatarRef: 'user-avatar' })
    const markup = renderToStaticMarkup(<ForwardRecordsDetail item={{ itemUid: 'forward', forwardRecords: forward } as ArkmeTimelineItem} onClose={() => {}} />)
    expect(markup.match(/aria-label="DeepSeek Harness 头像"/g)).toHaveLength(1)
    expect(markup).toContain('<svg')
    expect(markup).toContain('<pre')
    expect(markup).toContain('code_block()')
  })
})
