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
