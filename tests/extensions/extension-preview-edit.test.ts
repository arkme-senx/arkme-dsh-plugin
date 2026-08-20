import { describe, expect, it } from 'vitest'
import {
  appendExtensionPreviewFiles, createExtensionPreviewDraft, moveExtensionPreviewDraftItem, removeExtensionPreviewDraftItem,
} from '../../src/client/extension-preview-edit.js'

describe('extension preview edit draft', () => {
  it('stages valid files with stable ids and preserves complete order', () => {
    const remoteRef = `preview_v1_${'a'.repeat(64)}`
    const draft = createExtensionPreviewDraft([{
      preview_ref: remoteRef, content_type: 'image/png', preview_size: 4, width: 1, height: 1, created_at: 1,
    }], 3)
    const next = appendExtensionPreviewFiles(draft, [
      new File([new Uint8Array([1])], 'one.png', { type: 'image/png' }),
      new File([new Uint8Array([2])], 'two.webp', { type: 'image/webp' }),
    ], (() => { let value = 0; return () => `local-${String(++value)}` })(), () => '11111111-1111-4111-8111-111111111111')
    const moved = moveExtensionPreviewDraftItem(next, 'local-2', 0)
    const removed = removeExtensionPreviewDraftItem(moved, remoteRef)

    expect(removed.revision).toBe(3)
    expect(removed.initialRemoteRefs).toEqual([remoteRef])
    expect(removed.items.map(item => item.id)).toEqual(['local-2', 'local-1'])
  })

  it('rejects unsupported, empty, oversized and over-capacity selections as whole batches', () => {
    const draft = createExtensionPreviewDraft([], 0)
    const append = (files: File[]) => appendExtensionPreviewFiles(draft, files, () => 'id', () => 'mutation')
    expect(() => append([new File([new Uint8Array([1])], 'image.gif', { type: 'image/gif' })])).toThrow('PNG、JPEG 或 WebP')
    expect(() => append([new File([], 'empty.png', { type: 'image/png' })])).toThrow('5 MiB')
    expect(() => append([new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })])).toThrow('5 MiB')
    const full = createExtensionPreviewDraft(Array.from({ length: 20 }, (_value, index) => ({
      preview_ref: `preview_v1_${index.toString(16).padStart(64, '0')}`, content_type: 'image/png' as const,
      preview_size: 4, width: 1, height: 1, created_at: index,
    })), 20)
    expect(() => appendExtensionPreviewFiles(full, [new File([new Uint8Array([1])], 'one.png', { type: 'image/png' })], () => 'id', () => 'mutation'))
      .toThrow('最多只能有 20 张')
  })
})
