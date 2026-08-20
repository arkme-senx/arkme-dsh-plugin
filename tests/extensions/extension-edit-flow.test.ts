import { describe, expect, it, vi } from 'vitest'
import {
  applyEditedMyExtension,
  nextExtensionEditMutation,
  saveExtensionEdit,
} from '../../src/client/extension-edit-flow.js'

const extension = {
  extension_id: 'ext-1', name: '旧名称', description: '旧说明', visibility: 'private' as const,
  latest_stable_version: '1.0.0', updated_at: 1,
}
const value = { name: '新名称', description: '', visibility: 'public' as const }
const iconFile = new File([new Uint8Array([1, 2, 3])], 'icon.png', { type: 'image/png' })
const previewFile = new File([new Uint8Array([4, 5, 6])], 'preview.png', { type: 'image/png' })

describe('extension edit save flow', () => {
  it('does not upload an icon when metadata saving fails', async () => {
    const updateMetadata = vi.fn(async () => { throw new Error('metadata failed') })
    const setIcon = vi.fn()

    await expect(saveExtensionEdit({
      extension, value: { ...value, iconFile }, clientMutationId: 'mutation-1',
    }, { updateMetadata, setIcon })).rejects.toThrow('metadata failed')
    expect(setIcon).not.toHaveBeenCalled()
  })

  it('reports partial success when the icon fails after changed metadata was saved', async () => {
    const updated = { ...extension, ...value, updated_at: 2 }
    const result = await saveExtensionEdit({
      extension, value: { ...value, iconFile }, clientMutationId: 'mutation-1',
    }, {
      updateMetadata: vi.fn(async () => updated),
      setIcon: vi.fn(async () => { throw new Error('icon failed') }),
    })

    expect(result).toEqual({ kind: 'metadata-saved-icon-failed', extension: updated, error: 'icon failed' })
  })

  it('rejects an icon-only failure without claiming metadata partial success', async () => {
    const setIcon = vi.fn(async () => { throw new Error('icon failed') })
    await expect(saveExtensionEdit({
      extension, value: { name: extension.name, description: extension.description, visibility: 'private', iconFile },
      clientMutationId: 'mutation-1',
    }, { updateMetadata: vi.fn(), setIcon })).rejects.toThrow('icon failed')
  })

  it('returns the same server extension with the applied icon ref after complete success', async () => {
    const updated = { ...extension, ...value, updated_at: 2 }
    const result = await saveExtensionEdit({
      extension, value: { ...value, iconFile }, clientMutationId: 'mutation-1',
    }, {
      updateMetadata: vi.fn(async () => updated),
      setIcon: vi.fn(async () => ({
        icon_upload_session_id: 'iconup-1', extension_id: 'ext-1', status: 'applied' as const,
        icon_ref: `icon_v1_${'a'.repeat(64)}`, content_type: 'image/png' as const,
        icon_size: 3, icon_sha256: 'a'.repeat(64), updated_at: 3,
      })),
    })

    expect(result).toMatchObject({
      kind: 'saved', extension: { name: '新名称', visibility: 'public', icon_ref: `icon_v1_${'a'.repeat(64)}` },
    })
  })

  it('uploads staged preview files with their stable mutation ids', async () => {
    const previewRef = `preview_v1_${'b'.repeat(64)}`
    const addPreview = vi.fn(async () => ({
      extension_id: 'ext-1', applied_preview_ref: previewRef,
      preview_images: [{ preview_ref: previewRef, content_type: 'image/png' as const, preview_size: 3, width: 1, height: 1, created_at: 2 }],
      preview_revision: 1,
    }))
    const result = await saveExtensionEdit({
      extension,
      value: {
        ...value,
        previewDraft: {
          revision: 0,
          initialRemoteRefs: [],
          items: [{ kind: 'local', id: 'local-1', file: previewFile, mutationId: '11111111-1111-4111-8111-111111111111' }],
        },
      },
      clientMutationId: 'mutation-1',
    }, {
      updateMetadata: vi.fn(async () => ({ ...extension, ...value })),
      setIcon: vi.fn(),
      addPreview,
      deletePreview: vi.fn(),
      reorderPreviews: vi.fn(),
    } as never)

    expect(addPreview).toHaveBeenCalledWith('ext-1', previewFile, '11111111-1111-4111-8111-111111111111')
    expect(result).toMatchObject({ kind: 'saved', previews: { preview_revision: 1 } })
  })

  it('rejects a stale edit draft before any preview write', async () => {
    const remoteRef = `preview_v1_${'c'.repeat(64)}`
    const deletePreview = vi.fn()
    await expect(saveExtensionEdit({
      extension: { ...extension, preview_images: [], preview_revision: 3 },
      value: {
        ...value,
        previewDraft: {
          revision: 2, initialRemoteRefs: [remoteRef],
          items: [],
        },
      }, clientMutationId: 'mutation-stale',
    }, {
      updateMetadata: vi.fn(async () => ({ ...extension, ...value, preview_images: [], preview_revision: 3 })),
      setIcon: vi.fn(), addPreview: vi.fn(), deletePreview, reorderPreviews: vi.fn(),
    })).rejects.toThrow('预览图已在其他位置更新')
    expect(deletePreview).not.toHaveBeenCalled()
  })

  it('reconciles successful local uploads while retaining the failed local file for retry', async () => {
    const firstFile = new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })
    const secondFile = new File([new Uint8Array([2])], 'second.png', { type: 'image/png' })
    const appliedRef = `preview_v1_${'d'.repeat(64)}`
    const addPreview = vi.fn()
      .mockResolvedValueOnce({
        extension_id: 'ext-1', applied_preview_ref: appliedRef,
        preview_images: [{ preview_ref: appliedRef, content_type: 'image/png', preview_size: 1, width: 1, height: 1, created_at: 1 }],
        preview_revision: 1,
      })
      .mockRejectedValueOnce(new Error('second failed'))
    const result = await saveExtensionEdit({
      extension: { ...extension, preview_images: [], preview_revision: 0 },
      value: {
        ...value,
        previewDraft: { revision: 0, initialRemoteRefs: [], items: [
          { kind: 'local', id: 'local-1', file: firstFile, mutationId: '11111111-1111-4111-8111-111111111111' },
          { kind: 'local', id: 'local-2', file: secondFile, mutationId: '22222222-2222-4222-8222-222222222222' },
        ] },
      }, clientMutationId: 'mutation-partial',
    }, {
      updateMetadata: vi.fn(async () => ({ ...extension, ...value })), setIcon: vi.fn(), addPreview,
      deletePreview: vi.fn(), reorderPreviews: vi.fn(),
    })

    expect(result).toMatchObject({
      kind: 'profile-saved-preview-failed',
      previewDraft: {
        revision: 1, initialRemoteRefs: [appliedRef],
        items: [{ kind: 'remote', id: appliedRef }, { kind: 'local', id: 'local-2', mutationId: '22222222-2222-4222-8222-222222222222' }],
      },
    })
  })

  it('reuses a mutation UUID for the same normalized edit and rotates it after a field changes', () => {
    let sequence = 0
    const mint = () => `mutation-${String(++sequence)}`
    const first = nextExtensionEditMutation(undefined, 'ext-1', value, mint)
    const whitespaceRetry = nextExtensionEditMutation(first, 'ext-1', { ...value, name: ' 新名称 ' }, mint)
    const changed = nextExtensionEditMutation(first, 'ext-1', { ...value, visibility: 'private' }, mint)

    expect(whitespaceRetry.id).toBe(first.id)
    expect(changed.id).not.toBe(first.id)
  })

  it('projects the saved cloud facts back into the unified My Extension item', () => {
    const item = {
      ownedRef: 'owned-ref', name: '旧名称', description: '旧说明', states: ['published'] as const,
      halves: { host: true, client: false },
      published: { extensionId: 'ext-1', version: '1.0.0', visibility: 'private' as const },
      publish: { allowed: false, reason: '已发布' },
    }
    expect(applyEditedMyExtension(item, {
      ...extension, name: '新名称', description: '', visibility: 'public', icon_ref: `icon_v1_${'a'.repeat(64)}`,
    })).toMatchObject({
      name: '新名称', description: '',
      published: { extensionId: 'ext-1', version: '1.0.0', visibility: 'public', iconRef: `icon_v1_${'a'.repeat(64)}` },
    })
  })
})
