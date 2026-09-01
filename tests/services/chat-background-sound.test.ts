import { describe, expect, it, vi } from 'vitest'
import {
  ChatService, arkmeRichContentPayload, arkmeSnapshotBackgroundSoundState,
} from '../../src/services/chat-service.js'

const normalAudio = {
  fileAssetUid: 'asset-normal-audio',
  fileName: 'voice.m4a',
  mimeType: 'audio/mp4',
  size: 128,
  fileKind: 2 as const,
}

const backgroundAudio = {
  fileAssetUid: 'asset-background-audio',
  fileName: 'background.m4a',
  mimeType: 'audio/mp4',
  size: 256,
  fileKind: 2 as const,
}

function fixture() {
  const authenticatedChatPost = vi.fn(async () => ({ record_uid: 'record-1', audit_status: 1, seq: 9 }))
  const runtime = {
    config: { richMediaSendEnabled: true, maxTextLength: 20_000 },
    requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
    authenticatedChatPost,
  }
  const source = {
    openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-1' })),
  }
  const chat = new ChatService(
    runtime as never, source as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never,
    { scheduleChatSessionProjection() {} } as never,
  )
  return { chat, authenticatedChatPost }
}

describe('ChatService background-sound payload owner', () => {
  it('merges ordinary media, mention metadata, and explicit background media once', () => {
    const payload = arkmeRichContentPayload({
      textContent: '@小林 看附件',
      assets: [normalAudio],
      backgroundSound: { assets: [backgroundAudio], amplitudes: [0, 0.4, 1] },
    }, '@小林 看附件', {
      payload_kind: 1,
      schema_version: 1,
      text_state: 1,
      mention_metadata: { schema_version: 1, source_checksum: 'checksum' },
    })

    expect(payload).toEqual({
      payload_kind: 2,
      schema_version: 1,
      text_state: 1,
      media_refs: [
        {
          file_asset_uid: 'asset-normal-audio', content_file_role: 1, render_role: 1, sort_order: 0,
          file_name: 'voice.m4a',
        },
        {
          file_asset_uid: 'asset-background-audio', content_file_role: 4,
          binding_type: 4, render_role: 1, sort_order: 1,
          file_name: 'background.m4a',
        },
      ],
      background_sound_amplitudes: [0, 0.4, 1],
      mention_metadata: { schema_version: 1, source_checksum: 'checksum' },
    })
  })

  it('keeps a text record with only background media on the plain-text template', async () => {
    const { chat, authenticatedChatPost } = fixture()

    await chat.sendSourceRich('source-ref', {
      textContent: '带背景音的文字',
      backgroundSound: { assets: [backgroundAudio], amplitudes: [0.2, 0.8] },
    }, { recordUid: 'record-1', relationUid: 'relation-1' })

    expect(authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/records/send',
      expect.objectContaining({
        template_kind: 1,
        content_payload: expect.objectContaining({
          payload_kind: 1,
          media_refs: [{
            file_asset_uid: 'asset-background-audio', content_file_role: 4,
            binding_type: 4, render_role: 1, sort_order: 0, file_name: 'background.m4a',
          }],
          background_sound_amplitudes: [0.2, 0.8],
        }),
      }),
      expect.anything(),
      undefined,
      { trackWriteOutcome: true },
    )
    const body = authenticatedChatPost.mock.calls[0]![1] as Record<string, unknown>
    expect(JSON.stringify(body.content_payload)).not.toMatch(/file_type|file_kind|mime_type|"size"/u)
  })

  it('does not infer the background role from an ordinary audio MIME', async () => {
    const { chat, authenticatedChatPost } = fixture()

    await chat.sendSourceRich('source-ref', {
      textContent: '普通音频附件',
      assets: [normalAudio],
    }, { recordUid: 'record-1', relationUid: 'relation-1' })

    const body = authenticatedChatPost.mock.calls[0]![1] as Record<string, unknown>
    expect(body.template_kind).toBe(2)
    expect(body.content_payload).toMatchObject({
      media_refs: [expect.objectContaining({ content_file_role: 1, render_role: 1 })],
    })
    expect(JSON.stringify(body.content_payload)).not.toContain('background_sound_amplitudes')
    expect(JSON.stringify(body.content_payload)).not.toContain('"binding_type":4')
    expect(JSON.stringify(body.content_payload)).not.toContain('"file_type":5')
  })

  it('requires a real identified background-media row and never treats waveform samples as availability', () => {
    expect(arkmeSnapshotBackgroundSoundState({
      background_sound_amplitudes: [0.1, 0.9],
      media_refs: [{ content_file_role: 4 }],
    })).toBe('not-recorded')
    expect(arkmeSnapshotBackgroundSoundState({
      media_refs: [{ file_asset_uid: 'asset-background', content_file_role: 4 }],
    })).toBe('available')
    expect(arkmeSnapshotBackgroundSoundState({
      media_display_items: [{ uid: 'legacy-background', type: 5 }],
    })).toBe('available')
    expect(arkmeSnapshotBackgroundSoundState({
      files: [{ file_id: 81, file_type: 5 }],
    })).toBe('available')
    expect(arkmeSnapshotBackgroundSoundState({
      background_sound: { media_id: 'legacy-media-id', type: 5, amplitudes: [0.3] },
    })).toBe('available')
    expect(arkmeSnapshotBackgroundSoundState({
      files: [{ file_asset_uid: 'ordinary-audio', file_kind: 2, mime_type: 'audio/mp4', content_file_role: 1 }],
    })).toBe('not-recorded')
  })
})
