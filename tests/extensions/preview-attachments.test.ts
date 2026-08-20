import { describe, expect, it, vi } from 'vitest'
import { selectLatestUserPreviewAttachments } from '../../src/extensions/session-preview-attachments.js'
import { addPreviewAttachmentBatch } from '../../src/tools/extensions/preview-attachment-batch.js'

function image(char: string, mediaType: 'image/png' | 'image/webp' = 'image/png') {
  return {
    attachmentId: `sha256:${char.repeat(64)}`, mediaType, bytes: 4, width: 1, height: 1, name: `${char}.png`,
  }
}

describe('extension preview message attachments', () => {
  it('selects ordered indices only from the latest direct user message', () => {
    const first = image('a')
    const second = image('b', 'image/webp')
    const agent = { session: { events: [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: image('c') }] } },
      { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [
        { type: 'image', attachment: first }, { type: 'text', text: '选择' }, { type: 'image', attachment: second },
      ] } },
      { seq: 3, type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'image', attachment: image('d') }] } },
    ] } } as never

    expect(selectLatestUserPreviewAttachments(agent, [2, 1])).toEqual([
      { index: 2, ref: second }, { index: 1, ref: first },
    ])
    expect(() => selectLatestUserPreviewAttachments(agent, [1, 1])).toThrow('unique 1-based')
    expect(() => selectLatestUserPreviewAttachments(agent, [3])).toThrow('unique 1-based')
  })

  it('does not fall back to an older image message', () => {
    const agent = { session: { events: [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: image('a') }] } },
      { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再试一次' }] } },
    ] } } as never
    expect(() => selectLatestUserPreviewAttachments(agent)).toThrow('latest direct user message has no image attachments')
  })

  it('preflights gallery capacity before reading or uploading bytes', async () => {
    const readImage = vi.fn()
    const addPreview = vi.fn()
    const previews = Array.from({ length: 20 }, (_value, index) => ({ preview_ref: `preview_v1_${index.toString(16).padStart(64, '0')}` }))
    await expect(addPreviewAttachmentBatch({
      extensionId: 'ext-1', attachments: [{ index: 1, ref: image('a') as never }],
      store: { readImage } as never,
      manager: { myList: vi.fn(async () => ({ items: [{ extension_id: 'ext-1', preview_images: previews }], total: 1 })), addPreview } as never,
    })).rejects.toThrow('最多只能有 20 张')
    expect(readImage).not.toHaveBeenCalled()
    expect(addPreview).not.toHaveBeenCalled()
  })

  it('returns a safe partial result after a later remote failure', async () => {
    const first = image('a')
    const second = image('b')
    const stored = new Map([
      [first.attachmentId, { ref: first, data: new Uint8Array([1, 2, 3, 4]) }],
      [second.attachmentId, { ref: second, data: new Uint8Array([5, 6, 7, 8]) }],
    ])
    const addedRef = `preview_v1_${'c'.repeat(64)}`
    const addPreview = vi.fn()
      .mockResolvedValueOnce({
        extension_id: 'ext-1', preview_images: [{
          preview_ref: addedRef, content_type: 'image/png', preview_size: 4, width: 1, height: 1, created_at: 1,
        }], preview_revision: 1,
      })
      .mockRejectedValueOnce(new Error('remote unavailable'))
    const result = await addPreviewAttachmentBatch({
      extensionId: 'ext-1',
      attachments: [{ index: 1, ref: first as never }, { index: 2, ref: second as never }],
      store: { readImage: vi.fn(async (ref: { attachmentId: string }) => stored.get(ref.attachmentId)) } as never,
      manager: { myList: vi.fn(async () => ({ items: [{ extension_id: 'ext-1', preview_images: [], preview_revision: 0 }], total: 1 })), addPreview } as never,
    })

    expect(result).toEqual({
      outcome: 'partial', extension_id: 'ext-1', added_count: 1,
      preview_images: [{ preview_ref: addedRef, content_type: 'image/png', preview_size: 4, width: 1, height: 1, created_at: 1 }],
      preview_revision: 1, failed: { index: 2, message: 'remote unavailable' },
    })
    expect(JSON.stringify(result)).not.toContain('sha256:')
    expect(addPreview).toHaveBeenCalledTimes(2)
  })
})
