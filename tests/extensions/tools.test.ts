import { describe, expect, it, vi } from 'vitest'
import {
  ARKME_EXTENSION_AUTHORING_PREFLIGHT_PROMPT,
  registerArkmeExtensionTools,
} from '../../src/tools/extensions/index.js'

describe('Arkme extension tools', () => {
  it('registers the exact MVP surface only for business profiles and asks before writes', async () => {
    const definitions: Array<{
      name: string
      description?: string
      parameters?: Record<string, unknown>
      execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
    }> = []
    const sections: Array<{ name: string; order: number; text: () => string }> = []
    let guard: ((exec: { name: string; arguments: Record<string, unknown> }, next: () => Promise<{ kind: string }>) => Promise<unknown>) | undefined
    const context = {
      tools: { register: vi.fn(definition => { definitions.push(definition) }) },
      systemPrompt: { section: vi.fn(section => { sections.push(section) }) },
      on: vi.fn((_event, listener) => { guard = listener }),
    }
    const previewInstall = vi.fn(async () => ({
      extension_id: 'ext-native', version: '1.0.0', execution_model: 'dsh-native',
      package_name: '@example/native', manifest: { permissions: [] }, revoked: false,
    }))
    const setEnabled = vi.fn(async () => ({
      extension_id: 'ext-1', installed: true, enabled: false, active: false,
      restart_required: true, message: '已关闭',
    }))
    const updateMetadata = vi.fn(async () => ({
      extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private', updated_at: 2,
    }))
    const setIcon = vi.fn(async () => ({
      extension_id: 'ext-1', status: 'applied', icon_ref: `icon_v1_${'a'.repeat(64)}`,
    }))
    const previewRef = `preview_v1_${'c'.repeat(64)}`
    const addPreview = vi.fn(async () => ({
      extension_id: 'ext-1', applied_preview_ref: previewRef,
      preview_images: [{ preview_ref: previewRef, content_type: 'image/png', preview_size: 4, width: 640, height: 480, created_at: 1 }],
      preview_revision: 1,
    }))
    const deletePreview = vi.fn(async () => ({ extension_id: 'ext-1', preview_images: [], preview_revision: 2 }))
    const reorderPreviews = vi.fn(async () => ({
      extension_id: 'ext-1', preview_images: [{ preview_ref: previewRef }], preview_revision: 3,
    }))
    const readImage = vi.fn(async () => ({ mediaType: 'image/png', bytes: 4, data: new Uint8Array([1, 2, 3, 4]) }))
    registerArkmeExtensionTools(context as never, {
      previewInstall, setEnabled, updateMetadata, setIcon, addPreview, deletePreview, reorderPreviews,
    } as never, {} as never, { readImage }, 'business')

    expect(definitions.map(item => item.name)).toEqual([
      'arkme_extension_publish', 'arkme_extension_delete', 'arkme_extension_search', 'arkme_extension_inspect', 'arkme_extension_apply',
      'arkme_extension_list_mine', 'arkme_extension_set_enabled', 'arkme_extension_icon_set',
      'arkme_extension_edit',
      'arkme_extension_preview_add', 'arkme_extension_preview_delete', 'arkme_extension_preview_reorder',
    ])
    const listMine = definitions.find(item => item.name === 'arkme_extension_list_mine')
    expect(listMine?.description).toContain('current Arkme user')
    expect(listMine?.description).toContain('untrusted')
    const publish = definitions.find(item => item.name === 'arkme_extension_publish')
    expect(publish?.parameters).not.toHaveProperty('permissions')
    expect(publish?.parameters).toHaveProperty('properties.owned_ref')
    expect(publish?.parameters).not.toHaveProperty('properties.plugin_id')
    expect(publish?.parameters).not.toHaveProperty('properties.package_id')
    expect(publish?.description).toContain('exact returned validation message')
    expect(publish?.description).toContain('do not retry unchanged bytes')
    expect(publish?.description).toContain('arkme_extension_list_mine')
    expect(publish?.description).toContain('Profile-local DSH Bundle')
    expect(publish?.description).toContain('cordis_define')
    expect(publish?.description).toContain('arkme_extension_list_mine')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ name: 'tool:arkme-extension-authoring', order: 117 })
    expect(sections[0]?.text()).toBe(ARKME_EXTENSION_AUTHORING_PREFLIGHT_PROMPT)
    expect(sections[0]?.text()).toContain('before planning, coding, searching, or calling tools')
    expect(sections[0]?.text()).toContain('validated Profile-local Bundle')
    const deleteTool = definitions.find(item => item.name === 'arkme_extension_delete')
    expect(deleteTool?.parameters).toEqual({
      type: 'object',
      properties: {
        extension_id: { type: 'string', description: 'Exact extension_id owned by the current Arkme user.' },
      },
      required: ['extension_id'],
    })
    expect(deleteTool?.description).toContain('explicitly asks to delete it')
    const enabledTool = definitions.find(item => item.name === 'arkme_extension_set_enabled')
    await expect(enabledTool?.execute?.(
      { extension_id: 'ext-1', enabled: false },
      { agent: { id: 'session-1' } },
    )).resolves.toContain('"enabled": false')
    expect(setEnabled).toHaveBeenCalledWith({
      agent: { id: 'session-1' }, extensionId: 'ext-1', enabled: false,
    })
    const editTool = definitions.find(item => item.name === 'arkme_extension_edit')
    expect(editTool?.parameters).toHaveProperty('properties.visibility.enum', ['private', 'public'])
    await expect(editTool?.execute?.(
      { extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private' },
      { agent: { id: 'session-1' }, callId: 'call-edit', signal: new AbortController().signal },
    )).resolves.toContain('"name": "新名称"')
    expect(updateMetadata).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', name: '新名称', description: '', visibility: 'private',
      clientMutationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    const iconTool = definitions.find(item => item.name === 'arkme_extension_icon_set')
    await expect(iconTool?.execute?.(
      { extension_id: 'ext-1', image_ref: 'arkme-image-ref' },
      { agent: { id: 'session-1' }, callId: 'call-1' },
    )).resolves.toContain('"status": "applied"')
    expect(readImage).toHaveBeenCalledWith('arkme-image-ref', expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }))
    expect(setIcon).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', mediaType: 'image/png', data: new Uint8Array([1, 2, 3, 4]),
    }))
    const addPreviewTool = definitions.find(item => item.name === 'arkme_extension_preview_add')
    const addPreviewOutput = await addPreviewTool?.execute?.(
      { extension_id: 'ext-1', image_ref: 'arkme-preview-ref' },
      { agent: { id: 'session-1' }, callId: 'call-preview-add' },
    )
    expect(addPreviewOutput).toContain('"preview_revision": 1')
    expect(addPreviewOutput).not.toContain('arkme-preview-ref')
    expect(addPreviewOutput).not.toContain('upload_url')
    expect(addPreviewOutput).not.toContain('download_url')
    expect(readImage).toHaveBeenCalledWith('arkme-preview-ref', expect.objectContaining({ maxBytes: 5 * 1024 * 1024 }))
    expect(addPreview).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', mediaType: 'image/png', data: new Uint8Array([1, 2, 3, 4]),
    }))
    const deletePreviewTool = definitions.find(item => item.name === 'arkme_extension_preview_delete')
    await expect(deletePreviewTool?.execute?.(
      { extension_id: 'ext-1', preview_ref: previewRef, expected_revision: 1 },
      { agent: { id: 'session-1' }, callId: 'call-preview-delete' },
    )).resolves.toContain('"preview_revision": 2')
    expect(deletePreview).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', previewRef, expectedRevision: 1,
    }))
    const reorderPreviewTool = definitions.find(item => item.name === 'arkme_extension_preview_reorder')
    await expect(reorderPreviewTool?.execute?.(
      { extension_id: 'ext-1', ordered_preview_refs: [previewRef], expected_revision: 2 },
      { agent: { id: 'session-1' }, callId: 'call-preview-reorder' },
    )).resolves.toContain('"preview_revision": 3')
    expect(reorderPreviews).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', orderedPreviewRefs: [previewRef], expectedRevision: 2,
    }))
    await expect(guard!(
      { name: 'arkme_extension_publish', arguments: {
        owned_ref: 'owned-ref', name: '天气', version: '1.0.0', visibility: 'public',
      } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认将“我的扩展”中的“天气” 1.0.0 发布到扩展市场吗？可见范围：public。',
    })
    await expect(guard!(
      { name: 'arkme_extension_delete', arguments: { extension_id: 'ext-1' } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认软删除扩展 ext-1 吗？删除后将从扩展市场隐藏、禁止新安装和继续发版，并向已安装用户标记撤销；服务端记录和制品会保留。',
    })
    await expect(guard!(
      { name: 'arkme_extension_search', arguments: {} },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({ kind: 'allow' })
    await expect(guard!(
      { name: 'arkme_extension_apply', arguments: { extension_id: 'ext-native', version: '1.0.0' } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认下载、验签并在当前 DSH 会话应用扩展 ext-native@1.0.0 吗？该扩展是原生 DSH Bundle，将以 DSH 插件进程权限运行。',
    })
    expect(previewInstall).toHaveBeenCalledWith('ext-native', '1.0.0')
    await expect(guard!(
      { name: 'arkme_extension_set_enabled', arguments: { extension_id: 'ext-1', enabled: false } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask',
      reason: '确认关闭已安装扩展 ext-1 吗？扩展和版本会保留，稍后可重新启用。',
    })
    await expect(guard!(
      { name: 'arkme_extension_icon_set', arguments: { extension_id: 'ext-1', image_ref: 'arkme-image-ref' } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask', reason: '确认使用当前账号可读取的图片替换扩展 ext-1 的头像吗？',
    })
    await expect(guard!(
      { name: 'arkme_extension_edit', arguments: {
        extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private',
      } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({
      kind: 'ask', reason: '确认把扩展 ext-1 的资料更新为“新名称”，可见范围：仅自己吗？',
    })
    await expect(guard!(
      { name: 'arkme_extension_preview_add', arguments: { extension_id: 'ext-1', image_ref: 'arkme-preview-ref' } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({ kind: 'ask', reason: '确认把当前账号可读取的图片添加到扩展 ext-1 的预览图集吗？' })
    await expect(guard!(
      { name: 'arkme_extension_preview_delete', arguments: { extension_id: 'ext-1', preview_ref: previewRef, expected_revision: 1 } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({ kind: 'ask', reason: `确认从扩展 ext-1 删除预览图 ${previewRef} 吗？` })
    await expect(guard!(
      { name: 'arkme_extension_preview_reorder', arguments: { extension_id: 'ext-1', ordered_preview_refs: [previewRef], expected_revision: 2 } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({ kind: 'ask', reason: '确认把扩展 ext-1 的 1 张预览图按新顺序保存吗？第一张会作为封面。' })
  })

  it('does not expose extension writes in atomic or disabled profiles', () => {
    for (const profile of ['atomic', 'disabled'] as const) {
      const register = vi.fn()
      const section = vi.fn()
      registerArkmeExtensionTools({ tools: { register }, systemPrompt: { section }, on: vi.fn() } as never, {} as never, {} as never, {} as never, profile)
      expect(register).not.toHaveBeenCalled()
      expect(section).not.toHaveBeenCalled()
    }
  })
})
