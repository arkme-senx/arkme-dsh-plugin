import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    expect(publish?.parameters).toHaveProperty('properties.action.enum', ['prepare', 'confirm'])
    expect(publish?.parameters).toHaveProperty('properties.items')
    expect(publish?.parameters).not.toHaveProperty('properties.plugin_id')
    expect(publish?.parameters).not.toHaveProperty('properties.package_id')
    expect(publish?.description).toContain('1 to 10')
    expect(publish?.description).toContain('does not publish')
    expect(publish?.description).toContain('later direct human reply')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ name: 'tool:arkme-extension-authoring', order: 117 })
    expect(sections[0]?.text()).toBe(ARKME_EXTENSION_AUTHORING_PREFLIGHT_PROMPT)
    expect(sections[0]?.text()).toContain('before planning, coding, searching, or calling tools')
    expect(sections[0]?.text()).toContain('validated Profile-local Bundle')
    expect(sections[0]?.text()).toContain('workspace_path')
    expect(sections[0]?.text()).toContain('Do not search for image upload routes')
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
    expect(iconTool?.parameters).toHaveProperty('properties.workspace_path')
    expect(iconTool?.parameters).toHaveProperty('required', ['extension_id'])
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
      { name: 'arkme_extension_publish', arguments: { action: 'prepare', items: [{
        owned_ref: 'owned-ref', name: '天气', description: '天气', version: '1.0.0', visibility: 'public',
      }] } },
      async () => ({ kind: 'allow' }),
    )).resolves.toEqual({ kind: 'allow' })
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

  it('adds every image from the latest direct user message when image_ref is omitted', async () => {
    const definitions: Array<{
      name: string
      parameters?: Record<string, unknown>
      execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
    }> = []
    const first = {
      attachmentId: `sha256:${'a'.repeat(64)}`,
      mediaType: 'image/png', bytes: 4, width: 1, height: 1, name: 'first.png',
    }
    const second = {
      attachmentId: `sha256:${'b'.repeat(64)}`,
      mediaType: 'image/webp', bytes: 5, width: 1, height: 1, name: 'second.webp',
    }
    const stored = new Map([
      [first.attachmentId, { ref: first, data: new Uint8Array([1, 2, 3, 4]) }],
      [second.attachmentId, { ref: second, data: new Uint8Array([5, 6, 7, 8, 9]) }],
    ])
    const attachments = {
      readImage: vi.fn(async (ref: { attachmentId: string }) => stored.get(ref.attachmentId)),
    }
    let revision = 0
    const previewImages: Array<Record<string, unknown>> = []
    const addPreview = vi.fn(async (input: { mediaType: string; data: Uint8Array }) => {
      revision += 1
      previewImages.push({
        preview_ref: `preview_v1_${String(revision).repeat(64)}`, content_type: input.mediaType,
        preview_size: input.data.byteLength, width: 1, height: 1, created_at: revision,
      })
      return { extension_id: 'ext-1', preview_images: [...previewImages], preview_revision: revision }
    })
    const manager = {
      myList: vi.fn(async () => ({ items: [{ extension_id: 'ext-1', preview_images: [], preview_revision: 0 }], total: 1 })),
      addPreview,
    }
    registerArkmeExtensionTools({
      tools: { register: vi.fn(definition => { definitions.push(definition) }) },
      systemPrompt: { section: vi.fn() },
      on: vi.fn(),
      get: vi.fn((name: string) => name === 'attachments' ? attachments : undefined),
    } as never, manager as never, {} as never, { readImage: vi.fn() }, 'business')

    const tool = definitions.find(item => item.name === 'arkme_extension_preview_add')
    expect(tool?.parameters).toHaveProperty('required', ['extension_id'])
    expect(tool?.parameters).toHaveProperty('properties.attachment_indices.items.type', 'integer')
    const output = await tool?.execute?.({ extension_id: 'ext-1' }, {
      agent: {
        id: 'session-1',
        session: {
          events: [
            { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: first }] } },
            { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment: second }] } } },
            { seq: 3, type: 'user/message', data: { source: { kind: 'user' }, content: [
              { type: 'text', text: '上传这两张预览图' },
              { type: 'image', attachment: first },
              { type: 'image', attachment: second },
            ] } },
          ],
        },
      },
      callId: 'call-preview-attachments',
      signal: new AbortController().signal,
    })

    expect(output).toContain('"outcome": "complete"')
    expect(output).toContain('"added_count": 2')
    expect(output).not.toContain(first.attachmentId)
    expect(output).not.toContain('first.png')
    expect(attachments.readImage).toHaveBeenCalledTimes(2)
    expect(addPreview).toHaveBeenCalledTimes(2)
  })

  it('uploads a generated workspace SVG through the existing icon owner', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'arkme extension icon '))
    try {
      await mkdir(join(workspace, 'assets'))
      await writeFile(join(workspace, 'assets', 'icon.svg'), [
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
        '<rect width="64" height="64" rx="12" fill="#15b84e"/>',
        '</svg>',
      ].join(''))
      const definitions: Array<{
        name: string
        execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
      }> = []
      const setIcon = vi.fn(async () => ({
        extension_id: 'ext-1', status: 'applied', icon_ref: `icon_v1_${'a'.repeat(64)}`,
      }))
      registerArkmeExtensionTools({
        tools: { register: vi.fn(definition => { definitions.push(definition) }) },
        systemPrompt: { section: vi.fn() },
        on: vi.fn(),
      } as never, { setIcon } as never, {} as never, { readImage: vi.fn() }, 'business')

      const iconTool = definitions.find(item => item.name === 'arkme_extension_icon_set')
      await expect(iconTool?.execute?.(
        { extension_id: 'ext-1', workspace_path: 'assets/icon.svg' },
        {
          agent: { id: 'session-1', session: { header: { cwd: workspace } } },
          callId: 'call-workspace-icon',
        },
      )).resolves.toContain('"status": "applied"')
      expect(setIcon).toHaveBeenCalledWith(expect.objectContaining({
        extensionId: 'ext-1',
        mediaType: 'image/png',
        data: expect.any(Uint8Array),
      }))
      const uploaded = setIcon.mock.calls[0]?.[0]?.data as Uint8Array
      expect(Array.from(uploaded.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps workspace icon reads inside the current session workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'arkme icon owned '))
    const outside = await mkdtemp(join(tmpdir(), 'arkme icon outside '))
    try {
      await writeFile(join(outside, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
      await symlink(outside, join(workspace, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir')
      const definitions: Array<{
        name: string
        execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
      }> = []
      const setIcon = vi.fn()
      registerArkmeExtensionTools({
        tools: { register: vi.fn(definition => { definitions.push(definition) }) },
        systemPrompt: { section: vi.fn() },
        on: vi.fn(),
      } as never, { setIcon } as never, {} as never, { readImage: vi.fn() }, 'business')
      const iconTool = definitions.find(item => item.name === 'arkme_extension_icon_set')
      const exec = {
        agent: { id: 'session-1', session: { header: { cwd: workspace } } },
        callId: 'call-workspace-icon',
      }

      await expect(iconTool?.execute?.(
        { extension_id: 'ext-1', workspace_path: join(outside, 'icon.svg') }, exec,
      )).rejects.toThrow('absolute paths are not allowed')
      await expect(iconTool?.execute?.(
        { extension_id: 'ext-1', workspace_path: '../icon.svg' }, exec,
      )).rejects.toThrow('path traversal is not allowed')
      await expect(iconTool?.execute?.(
        { extension_id: 'ext-1', workspace_path: 'escaped/icon.svg' }, exec,
      )).rejects.toThrow('outside the current Agent workspace')
      expect(setIcon).not.toHaveBeenCalled()
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects ambiguous icon sources and unsafe SVG content before cloud upload', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'arkme unsafe icon '))
    try {
      await writeFile(join(workspace, 'unsafe.svg'), [
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">',
        '<script>alert(1)</script>',
        '</svg>',
      ].join(''))
      await writeFile(join(workspace, 'styled.svg'), [
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">',
        '<rect width="64" height="64" style="fill:red"/>',
        '</svg>',
      ].join(''))
      await writeFile(join(workspace, 'safe.svg'), [
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">',
        '<rect width="64" height="64" fill="red"/>',
        '</svg>',
      ].join(''))
      const definitions: Array<{
        name: string
        execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
      }> = []
      const setIcon = vi.fn()
      registerArkmeExtensionTools({
        tools: { register: vi.fn(definition => { definitions.push(definition) }) },
        systemPrompt: { section: vi.fn() },
        on: vi.fn(),
      } as never, { setIcon } as never, {} as never, { readImage: vi.fn() }, 'business')
      const iconTool = definitions.find(item => item.name === 'arkme_extension_icon_set')
      const exec = {
        agent: { id: 'session-1', session: { header: { cwd: workspace } } },
        callId: 'call-workspace-icon',
      }

      await expect(iconTool?.execute?.({ extension_id: 'ext-1' }, exec))
        .rejects.toThrow('provide exactly one of image_ref or workspace_path')
      await expect(iconTool?.execute?.({
        extension_id: 'ext-1', image_ref: 'arkme-ref', workspace_path: 'unsafe.svg',
      }, exec)).rejects.toThrow('provide exactly one of image_ref or workspace_path')
      await expect(iconTool?.execute?.(
        { extension_id: 'ext-1', workspace_path: 'unsafe.svg' }, exec,
      )).rejects.toThrow('SVG executable, embedded, linked, or external-resource elements are not allowed')
      await expect(iconTool?.execute?.(
        { extension_id: 'ext-1', workspace_path: 'styled.svg' }, exec,
      )).rejects.toThrow('SVG links, styles, event handlers, and processing instructions are not allowed')
      const controller = new AbortController()
      controller.abort(new Error('cancelled by test'))
      await expect(iconTool?.execute?.(
        { extension_id: 'ext-1', workspace_path: 'safe.svg' }, { ...exec, signal: controller.signal },
      )).rejects.toThrow('cancelled by test')
      expect(setIcon).not.toHaveBeenCalled()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
