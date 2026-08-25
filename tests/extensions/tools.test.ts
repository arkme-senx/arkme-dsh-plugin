import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  ARKME_EXTENSION_AUTHORING_PREFLIGHT_PROMPT,
  registerArkmeExtensionTools,
} from '../../src/tools/extensions/index.js'

function confirmationAgent(id: string, intent: string) {
  return {
    id,
    session: { events: [
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: intent }] } },
    ] },
  }
}

function addNaturalConfirmation(agent: ReturnType<typeof confirmationAgent>, text = '可以，就这样做吧') {
  agent.session.events.push({
    seq: agent.session.events.length + 1,
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
  })
}

function toolExec(agent: ReturnType<typeof confirmationAgent>, callId: string) {
  return { agent, callId, signal: new AbortController().signal }
}

describe('Arkme extension tools', () => {
  it('registers the exact MVP surface and uses conversational confirmation without approval hooks', async () => {
    const raster = new Uint8Array(await sharp({
      create: { width: 640, height: 480, channels: 4, background: '#16a34a' },
    }).png().toBuffer())
    const definitions: Array<{
      name: string
      description?: string
      parameters?: Record<string, unknown>
      execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
    }> = []
    const sections: Array<{ name: string; order: number; text: () => string }> = []
    const context = {
      tools: { register: vi.fn(definition => { definitions.push(definition) }) },
      systemPrompt: { section: vi.fn(section => { sections.push(section) }) },
      on: vi.fn(),
    }
    const previewInstall = vi.fn(async () => ({
      extension_id: 'ext-native', version: '1.0.0', execution_model: 'dsh-native',
      package_name: '@example/native', manifest: { permissions: [] }, revoked: false,
    }))
    const setEnabled = vi.fn(async () => ({
      extension_id: 'ext-1', installed: true, enabled: false, active: false,
      restart_required: true, message: '已关闭',
    }))
    const listInstalled = vi.fn(() => [{
      extensionId: 'ext-broken', installedVersion: '1.0.0', manifest: { name: '故障扩展' },
      enabled: false, active: false, permissionSnapshot: [], updateChannel: 'stable',
      installedAtMillis: 1, lastCheckedAtMillis: 1,
      unavailable: { code: 'runtime-load-failed', message: '插件运行失败，已自动停用。' },
    }])
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
    const deleteExtension = vi.fn(async () => ({
      extension_id: 'ext-1', status: 'deleted', installed: false, active: false,
      references_removed: true, removed_source_count: 1, restart_required: false, message: '扩展已完全移除',
    }))
    const unpublishExtension = vi.fn(async () => ({
      extension_id: 'ext-1', status: 'suspended', unpublished_at: 1780000000123,
    }))
    const saveToProfile = vi.fn(async () => ({
      packageName: '@arkme-generated/weather', version: '1.0.0', artifactContractVersion: 2,
      artifactKind: 'dsh-bundle-tgz', installed: true, active: false, restartRequired: true, message: 'saved',
    }))
    const applyExtension = vi.fn(async () => ({
      extension_id: 'ext-native', version: '1.0.0', state: 'active', installed: true, active: true,
      approval_required: false, restart_required: false, message: '已激活',
    }))
    const rotateShareLink = vi.fn(async () => ({
      ref: 'extshare_0123456789abcdef0123456789abcdef',
      url: 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef',
    }))
		const readSharedDetail = vi.fn(async () => ({
			name: '天气', description: '天气扩展', visibility: 'private', share_scope: 'link_readonly',
			latest_stable_version: '1.0.0', preview_images: [],
			rating_summary: { average: 4.5, count: 2, histogram: [0, 0, 0, 1, 1] },
		}))
    const auditExtension = vi.fn(async () => ({
      extension_id: 'ext-1', trigger: 'tool', verdict: 'pass', risk_level: 'low',
      summary: '未发现明显风险', reasons: [], recommendations: [], source_reviewed: false,
      source_scope: 'public_detail_only', audited_at_millis: 1,
    }))
    const searchCatalog = vi.fn(async () => ({ items: [], total: 0 }))
    const readImage = vi.fn(async () => ({ mediaType: 'image/png', bytes: raster.byteLength, data: raster }))
    registerArkmeExtensionTools(context as never, {
      previewInstall, listInstalled, setEnabled, updateMetadata, rotateShareLink, readSharedDetail,
      setIcon, addPreview, deletePreview, reorderPreviews,
      apply: applyExtension,
      auditExtension,
      searchCatalog,
      myList: vi.fn(async () => ({ items: [{ extension_id: 'ext-1', preview_images: [], preview_revision: 0 }], total: 1 })),
    } as never, { delete: deleteExtension, unpublish: unpublishExtension, saveToProfile } as never, { readImage }, 'business')

    expect(definitions.map(item => item.name)).toEqual([
      'arkme_extension_save_profile', 'arkme_extension_publish', 'arkme_extension_unpublish', 'arkme_extension_delete', 'arkme_extension_search', 'arkme_extension_inspect', 'arkme_extension_audit', 'arkme_extension_apply',
      'arkme_extension_list_mine', 'arkme_extension_list_installed', 'arkme_extension_set_enabled', 'arkme_extension_icon_set',
      'arkme_extension_edit',
		'arkme_extension_share', 'arkme_extension_share_read',
      'arkme_extension_preview_add', 'arkme_extension_preview_delete', 'arkme_extension_preview_reorder',
    ])
    const listMine = definitions.find(item => item.name === 'arkme_extension_list_mine')
    expect(listMine?.description).toContain('current Arkme user')
    expect(listMine?.description).toContain('dynamic-cordis-v2')
    expect(listMine?.description).toContain('profile-native-v3')
    expect(listMine?.description).toContain('untrusted')
    const saveProfile = definitions.find(item => item.name === 'arkme_extension_save_profile')
    expect(saveProfile?.description).toContain('never uploads')
    expect(saveProfile?.parameters).toHaveProperty('properties.owned_ref')
    expect(saveProfile?.parameters).toHaveProperty('properties.version')
    const saveAgent = confirmationAgent('session-profile-save', '保存到 Profile')
    const saveArguments = {
      owned_ref: 'owned-ref', name: '天气助手', description: '天气', version: '1.0.0',
    }
    await expect(saveProfile?.execute?.(
      saveArguments, toolExec(saveAgent, 'call-profile-save-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(saveToProfile).not.toHaveBeenCalled()
    addNaturalConfirmation(saveAgent, '确认保存')
    await expect(saveProfile?.execute?.(
      saveArguments, toolExec(saveAgent, 'call-profile-save-confirm'),
    )).resolves.toContain('"restartRequired": true')
    expect(saveToProfile).toHaveBeenCalledWith(expect.objectContaining({
      ownedRef: 'owned-ref', name: '天气助手', description: '天气', version: '1.0.0',
      clientMutationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    const listInstalledTool = definitions.find(item => item.name === 'arkme_extension_list_installed')
    await expect(listInstalledTool?.execute?.({}, toolExec(confirmationAgent('session-list', '查看已安装扩展'), 'call-list')))
      .resolves.toContain('"message": "插件运行失败，已自动停用。"')
    expect(listInstalled).toHaveBeenCalledOnce()
    const search = definitions.find(item => item.name === 'arkme_extension_search')
    expect(search?.parameters).toHaveProperty('properties.limit.description', 'Result count, 1-100. Defaults to 20.')
    expect(search?.parameters).toHaveProperty('properties.owner_user_id.type', 'integer')
    expect(search?.parameters).toHaveProperty('properties.exclude_extension_id.type', 'string')
    await expect(search?.execute?.({
      owner_user_id: 77,
      exclude_extension_id: 'ext-current',
      sort: 'opens',
      limit: 70,
    }, toolExec(confirmationAgent('session-search', '查看作者其他插件'), 'call-search'))).resolves.toContain('"total": 0')
    expect(searchCatalog).toHaveBeenCalledWith({
      ownerUserId: 77,
      excludeExtensionId: 'ext-current',
      sort: 'opens',
      limit: 70,
    }, expect.any(AbortSignal))
    const publish = definitions.find(item => item.name === 'arkme_extension_publish')
    expect(publish?.parameters).toHaveProperty('properties.action.enum', ['prepare', 'confirm'])
    expect(publish?.parameters).toHaveProperty('properties.items')
		expect(publish?.parameters).toHaveProperty('properties.items.items.properties.github_repository_url')
		expect(publish?.parameters).toHaveProperty(
			'properties.items.items.properties.github_repository_url.description',
			'Optional canonical GitHub repository root used only as publisher-attested source metadata. It never selects an upload route.',
		)
    expect(publish?.parameters).not.toHaveProperty('properties.publication_mode')
    expect(publish?.parameters).not.toHaveProperty('properties.publisher_role')
    expect(publish?.parameters).not.toHaveProperty('properties.items.items.properties.publication_mode')
    expect(publish?.parameters).not.toHaveProperty('properties.items.items.properties.publisher_role')
    expect(publish?.parameters).not.toHaveProperty('properties.plugin_id')
    expect(publish?.parameters).not.toHaveProperty('properties.package_id')
    expect(publish?.description).toContain('1 to 10')
    expect(publish?.description).toContain('artifact_contract_version=2')
    expect(publish?.description).toContain('artifact_contract_version=3')
    expect(publish?.description).toContain('not an upload route')
		expect(publish?.description).not.toContain('required for public/unlisted V3')
    expect(publish?.description).toContain('does not publish')
    expect(publish?.description).toContain('later direct human message')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ name: 'tool:arkme-extension-authoring', order: 117 })
    expect(sections[0]?.text()).toBe(ARKME_EXTENSION_AUTHORING_PREFLIGHT_PROMPT)
    expect(sections[0]?.text()).toContain('one product-level extension flow')
    expect(sections[0]?.text()).toContain('arkme_extension_save_profile')
    expect(sections[0]?.text()).toContain('publish.route, artifactContractVersion, artifactKind')
    expect(sections[0]?.text()).toContain('not a third upload route')
    expect(sections[0]?.text()).toContain('before planning, coding, searching, or calling tools')
    expect(sections[0]?.text()).toContain('validated Profile-local Bundle')
    expect(sections[0]?.text()).toContain('workspace_path')
    expect(sections[0]?.text()).toContain('workspace_paths')
    expect(sections[0]?.text()).toContain('ordinary conversation')
    expect(sections[0]?.text()).toContain('arkme_extension_audit')
    expect(sections[0]?.text()).toContain('Do not search for image upload routes')
    const auditTool = definitions.find(item => item.name === 'arkme_extension_audit')
    await expect(auditTool?.execute?.(
      { extension_id: 'ext-1' },
      toolExec(confirmationAgent('session-audit', '审核扩展'), 'call-audit'),
    )).resolves.toContain('<data_from_arkme_extension_audit>')
    expect(auditExtension).toHaveBeenCalledWith({
      extensionId: 'ext-1', trigger: 'tool', signal: expect.any(AbortSignal),
    })
    const deleteTool = definitions.find(item => item.name === 'arkme_extension_delete')
    const unpublishTool = definitions.find(item => item.name === 'arkme_extension_unpublish')
    expect(deleteTool?.parameters).toEqual({
      type: 'object',
      properties: {
        extension_id: { type: 'string', description: 'Exact extension_id owned by the current Arkme user.' },
      },
      required: ['extension_id'],
    })
    expect(deleteTool?.description).toContain('explicitly asks to permanently delete it')
    expect(deleteTool?.description).toContain('irreversible')
    expect(unpublishTool?.description).toContain('later new-version publish')
    const enabledTool = definitions.find(item => item.name === 'arkme_extension_set_enabled')
    const enabledAgent = confirmationAgent('session-enabled', '关闭这个扩展')
    await expect(enabledTool?.execute?.(
      { extension_id: 'ext-1', enabled: false },
      toolExec(enabledAgent, 'call-enabled-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(setEnabled).not.toHaveBeenCalled()
    addNaturalConfirmation(enabledAgent, '行，先关掉吧')
    await expect(enabledTool?.execute?.(
      { extension_id: 'ext-1', enabled: false },
      toolExec(enabledAgent, 'call-enabled-confirm'),
    )).resolves.toContain('"enabled": false')
    expect(setEnabled).toHaveBeenCalledWith({
      agent: enabledAgent, extensionId: 'ext-1', enabled: false,
    })
    const editTool = definitions.find(item => item.name === 'arkme_extension_edit')
    expect(editTool?.parameters).toHaveProperty('properties.visibility.enum', ['private', 'public'])
    const editAgent = confirmationAgent('session-edit', '修改扩展资料')
    await expect(editTool?.execute?.(
      { extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private' },
      toolExec(editAgent, 'call-edit-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(updateMetadata).not.toHaveBeenCalled()
    addNaturalConfirmation(editAgent, '没问题，保存')
    await expect(editTool?.execute?.(
      { extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private' },
      toolExec(editAgent, 'call-edit-confirm'),
    )).resolves.toContain('"name": "新名称"')
    expect(updateMetadata).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', name: '新名称', description: '', visibility: 'private',
      clientMutationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    const shareTool = definitions.find(item => item.name === 'arkme_extension_share')
    const shareAgent = confirmationAgent('session-share', '轮换分享链接')
    await expect(shareTool?.execute?.(
      { extension_id: 'ext-1' }, toolExec(shareAgent, 'call-share-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(rotateShareLink).not.toHaveBeenCalled()
    addNaturalConfirmation(shareAgent, '确认轮换')
    await expect(shareTool?.execute?.(
      { extension_id: 'ext-1' }, toolExec(shareAgent, 'call-share-confirm'),
    )).resolves.toContain('extshare_0123456789abcdef0123456789abcdef')
    expect(rotateShareLink).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', clientMutationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
		const shareReadTool = definitions.find(item => item.name === 'arkme_extension_share_read')
		await expect(shareReadTool?.execute?.(
			{ share_ref: 'extshare_0123456789abcdef0123456789abcdef' },
			{ signal: new AbortController().signal },
		)).resolves.toContain('"share_scope": "link_readonly"')
		expect(readSharedDetail).toHaveBeenCalledWith(
			'extshare_0123456789abcdef0123456789abcdef',
			expect.any(AbortSignal),
		)
    const iconTool = definitions.find(item => item.name === 'arkme_extension_icon_set')
    expect(iconTool?.parameters).toHaveProperty('properties.workspace_path')
    expect(iconTool?.parameters).toHaveProperty('required', ['action'])
    expect(iconTool?.description).toContain('ordinary conversation')
    const iconAgent = confirmationAgent('session-icon', '替换头像')
    const iconPrepare = await iconTool?.execute?.(
      { action: 'prepare', extension_id: 'ext-1', image_ref: 'arkme-image-ref' },
      { agent: iconAgent, callId: 'call-1' },
    ) as string
    expect(iconPrepare).toContain('"status": "confirmation_required"')
    expect(setIcon).not.toHaveBeenCalled()
    expect(iconPrepare).not.toContain('expectedReply')
    addNaturalConfirmation(iconAgent, '可以，用这张')
    await expect(iconTool?.execute?.(
      { action: 'confirm' }, { agent: iconAgent, callId: 'call-2' },
    )).resolves.toContain('"status": "applied"')
    expect(readImage).toHaveBeenCalledWith('arkme-image-ref', expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }))
    expect(setIcon).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', mediaType: 'image/png', data: raster,
    }))
    const addPreviewTool = definitions.find(item => item.name === 'arkme_extension_preview_add')
    expect(addPreviewTool?.parameters).toHaveProperty('properties.workspace_paths.items.type', 'string')
    expect(addPreviewTool?.description).toContain('Agent-workspace')
    expect(addPreviewTool?.description).toContain('ordinary conversation')
    const previewAgent = confirmationAgent('session-preview', '添加预览图')
    const previewPrepare = await addPreviewTool?.execute?.(
      { action: 'prepare', extension_id: 'ext-1', image_ref: 'arkme-preview-ref' },
      { agent: previewAgent, callId: 'call-preview-prepare' },
    ) as string
    expect(previewPrepare).toContain('"status": "confirmation_required"')
    expect(previewPrepare).not.toContain('expectedReply')
    addNaturalConfirmation(previewAgent, '加进去吧')
    const addPreviewOutput = await addPreviewTool?.execute?.(
      { action: 'confirm' },
      { agent: previewAgent, callId: 'call-preview-confirm' },
    )
    expect(addPreviewOutput).toContain('"preview_revision": 1')
    expect(addPreviewOutput).not.toContain('arkme-preview-ref')
    expect(addPreviewOutput).not.toContain('upload_url')
    expect(addPreviewOutput).not.toContain('download_url')
    expect(readImage).toHaveBeenCalledWith('arkme-preview-ref', expect.objectContaining({ maxBytes: 5 * 1024 * 1024 }))
    expect(addPreview).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', mediaType: 'image/png', data: raster,
    }))
    const deletePreviewTool = definitions.find(item => item.name === 'arkme_extension_preview_delete')
    const deletePreviewAgent = confirmationAgent('session-preview-delete', '删除这张预览图')
    await expect(deletePreviewTool?.execute?.(
      { extension_id: 'ext-1', preview_ref: previewRef, expected_revision: 1 },
      toolExec(deletePreviewAgent, 'call-preview-delete-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(deletePreview).not.toHaveBeenCalled()
    addNaturalConfirmation(deletePreviewAgent, '删掉吧')
    await expect(deletePreviewTool?.execute?.(
      { extension_id: 'ext-1', preview_ref: previewRef, expected_revision: 1 },
      toolExec(deletePreviewAgent, 'call-preview-delete-confirm'),
    )).resolves.toContain('"preview_revision": 2')
    expect(deletePreview).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', previewRef, expectedRevision: 1,
    }))
    const reorderPreviewTool = definitions.find(item => item.name === 'arkme_extension_preview_reorder')
    const reorderAgent = confirmationAgent('session-preview-reorder', '调整预览图顺序')
    await expect(reorderPreviewTool?.execute?.(
      { extension_id: 'ext-1', ordered_preview_refs: [previewRef], expected_revision: 2 },
      toolExec(reorderAgent, 'call-preview-reorder-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(reorderPreviews).not.toHaveBeenCalled()
    addNaturalConfirmation(reorderAgent, '这个顺序可以')
    await expect(reorderPreviewTool?.execute?.(
      { extension_id: 'ext-1', ordered_preview_refs: [previewRef], expected_revision: 2 },
      toolExec(reorderAgent, 'call-preview-reorder-confirm'),
    )).resolves.toContain('"preview_revision": 3')
    expect(reorderPreviews).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-1', orderedPreviewRefs: [previewRef], expectedRevision: 2,
    }))
    const deleteAgent = confirmationAgent('session-delete', '删除扩展')
    const unpublishAgent = confirmationAgent('session-unpublish', '下架扩展')
    await expect(unpublishTool?.execute?.(
      { extension_id: 'ext-1' }, toolExec(unpublishAgent, 'call-unpublish-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(unpublishExtension).not.toHaveBeenCalled()
    addNaturalConfirmation(unpublishAgent, '是的，先下架')
    await expect(unpublishTool?.execute?.(
      { extension_id: 'ext-1' }, toolExec(unpublishAgent, 'call-unpublish-confirm'),
    )).resolves.toContain('"status": "suspended"')
    expect(unpublishExtension).toHaveBeenCalledWith({
      extensionId: 'ext-1', signal: expect.any(AbortSignal),
    })
    await expect(deleteTool?.execute?.(
      { extension_id: 'ext-1' }, toolExec(deleteAgent, 'call-delete-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(deleteExtension).not.toHaveBeenCalled()
    addNaturalConfirmation(deleteAgent, '是的，删除它')
    await expect(deleteTool?.execute?.(
      { extension_id: 'ext-1' }, toolExec(deleteAgent, 'call-delete-confirm'),
    )).resolves.toContain('"status": "deleted"')
    expect(deleteExtension).toHaveBeenCalledWith({
      agent: deleteAgent, extensionId: 'ext-1', signal: expect.any(AbortSignal),
    })

    const applyTool = definitions.find(item => item.name === 'arkme_extension_apply')
    const applyAgent = confirmationAgent('session-apply', '安装原生扩展')
    await expect(applyTool?.execute?.(
      { extension_id: 'ext-native', version: '1.0.0' }, toolExec(applyAgent, 'call-apply-prepare'),
    )).resolves.toContain('"status": "confirmation_required"')
    expect(applyExtension).not.toHaveBeenCalled()
    addNaturalConfirmation(applyAgent, '我了解风险，继续安装')
    await expect(applyTool?.execute?.(
      { extension_id: 'ext-native', version: '1.0.0' }, toolExec(applyAgent, 'call-apply-confirm'),
    )).resolves.toContain('"active": true')
    expect(applyExtension).toHaveBeenCalledWith(expect.objectContaining({
      agent: applyAgent, extensionId: 'ext-native', version: '1.0.0',
    }))
    expect(previewInstall).toHaveBeenCalledWith('ext-native', '1.0.0')
    expect(context.on).not.toHaveBeenCalled()
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
      mediaType: 'image/png', bytes: 4, width: 640, height: 480, name: 'first.png',
    }
    const second = {
      attachmentId: `sha256:${'b'.repeat(64)}`,
      mediaType: 'image/webp', bytes: 5, width: 800, height: 600, name: 'second.webp',
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
    expect(tool?.parameters).toHaveProperty('required', ['action'])
    expect(tool?.parameters).toHaveProperty('properties.attachment_indices.items.type', 'integer')
    const previewAgent = {
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
    }
    const attachmentPrepare = await tool?.execute?.({ action: 'prepare', extension_id: 'ext-1' }, {
      agent: previewAgent,
      callId: 'call-preview-attachments',
      signal: new AbortController().signal,
    }) as string
    expect(attachmentPrepare).toContain('"status": "confirmation_required"')
    expect(attachmentPrepare).not.toContain('expectedReply')
    expect(addPreview).not.toHaveBeenCalled()
    previewAgent.session.events.push({
      seq: 4, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '这些图可以，添加吧' }] },
    } as never)
    const output = await tool?.execute?.({ action: 'confirm' }, {
      agent: previewAgent,
      callId: 'call-preview-attachments-confirm',
      signal: new AbortController().signal,
    })

    expect(output).toContain('"outcome": "complete"')
    expect(output).toContain('"added_count": 2')
    expect(output).not.toContain(first.attachmentId)
    expect(output).not.toContain('first.png')
    expect(attachments.readImage).toHaveBeenCalledTimes(4)
    expect(addPreview).toHaveBeenCalledTimes(2)
  })

  it('uploads Agent-generated workspace images to the preview gallery in order', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'arkme extension previews '))
    try {
      await mkdir(join(workspace, 'assets'))
      await writeFile(join(workspace, 'assets', 'preview-1.svg'), [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
        '<rect width="1280" height="720" fill="#111827"/>',
        '<circle cx="640" cy="360" r="180" fill="#22c55e"/>',
        '</svg>',
      ].join(''))
      await writeFile(join(workspace, 'assets', 'preview-2.svg'), [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
        '<rect width="1280" height="720" fill="#f8fafc"/>',
        '<rect x="300" y="180" width="680" height="360" rx="48" fill="#16a34a"/>',
        '</svg>',
      ].join(''))
      const definitions: Array<{
        name: string
        execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
      }> = []
      let revision = 0
      const gallery: Array<Record<string, unknown>> = []
      const addPreview = vi.fn(async (input: { mediaType: string; data: Uint8Array }) => {
        revision += 1
        const item = {
          preview_ref: `preview_v1_${String(revision).repeat(64)}`,
          content_type: input.mediaType,
          preview_size: input.data.byteLength,
          width: 1280,
          height: 720,
          created_at: revision,
        }
        gallery.push(item)
        return { extension_id: 'ext-1', preview_images: [...gallery], preview_revision: revision }
      })
      const manager = {
        myList: vi.fn(async () => ({ items: [{ extension_id: 'ext-1', preview_images: [], preview_revision: 0 }], total: 1 })),
        addPreview,
      }
      registerArkmeExtensionTools({
        tools: { register: vi.fn(definition => { definitions.push(definition) }) },
        systemPrompt: { section: vi.fn() },
        on: vi.fn(),
        get: vi.fn(),
      } as never, manager as never, {} as never, { readImage: vi.fn() }, 'business')

      const tool = definitions.find(item => item.name === 'arkme_extension_preview_add')
      const previewAgent = { id: 'session-1', session: {
        header: { cwd: workspace },
        events: [{ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '添加生成的预览图' }] } }],
      } }
      const workspacePrepare = await tool?.execute?.({
        action: 'prepare',
        extension_id: 'ext-1',
        workspace_paths: ['assets/preview-1.svg', 'assets/preview-2.svg'],
      }, {
        agent: previewAgent,
        callId: 'call-workspace-previews',
      }) as string
      expect(workspacePrepare).toContain('"status": "confirmation_required"')
      expect(workspacePrepare).not.toContain('expectedReply')
      expect(addPreview).not.toHaveBeenCalled()
      previewAgent.session.events.push({
        seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '按这个顺序加进去' }] },
      } as never)
      const output = await tool?.execute?.({ action: 'confirm' }, {
        agent: previewAgent,
        callId: 'call-workspace-previews-confirm',
      })

      expect(output).toContain('"outcome": "complete"')
      expect(output).toContain('"added_count": 2')
      expect(output).not.toContain('workspace_paths')
      expect(addPreview).toHaveBeenCalledTimes(2)
      expect(addPreview).toHaveBeenNthCalledWith(1, expect.objectContaining({
        extensionId: 'ext-1', mediaType: 'image/png', data: expect.any(Uint8Array),
      }))
      expect(Array.from((addPreview.mock.calls[0]?.[0]?.data as Uint8Array).slice(0, 8)))
        .toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects ambiguous or escaping workspace preview sources before upload', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'arkme preview owned '))
    try {
      await writeFile(join(workspace, 'safe.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"/>')
      const definitions: Array<{
        name: string
        execute?: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
      }> = []
      const addPreview = vi.fn()
      registerArkmeExtensionTools({
        tools: { register: vi.fn(definition => { definitions.push(definition) }) },
        systemPrompt: { section: vi.fn() },
        on: vi.fn(),
        get: vi.fn(),
      } as never, {
        myList: vi.fn(async () => ({ items: [{ extension_id: 'ext-1', preview_images: [], preview_revision: 0 }], total: 1 })),
        addPreview,
      } as never, {} as never, { readImage: vi.fn() }, 'business')
      const tool = definitions.find(item => item.name === 'arkme_extension_preview_add')
      const exec = {
        agent: { id: 'session-1', session: { header: { cwd: workspace }, events: [] } },
        callId: 'call-workspace-previews',
      }

      await expect(tool?.execute?.({
        action: 'prepare', extension_id: 'ext-1', image_ref: 'arkme-ref', workspace_paths: ['safe.svg'],
      }, exec)).rejects.toThrow('provide exactly one preview image source')
      await expect(tool?.execute?.({
        action: 'prepare', extension_id: 'ext-1', workspace_paths: ['safe.svg', '../outside.png'],
      }, exec)).rejects.toThrow('path traversal is not allowed')
      expect(addPreview).not.toHaveBeenCalled()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
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
      const iconAgent = { id: 'session-1', session: {
        header: { cwd: workspace },
        events: [{ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '替换头像' }] } }],
      } }
      const workspaceIconPrepare = await iconTool?.execute?.(
        { action: 'prepare', extension_id: 'ext-1', workspace_path: 'assets/icon.svg' },
        {
          agent: iconAgent,
          callId: 'call-workspace-icon',
        },
      ) as string
      expect(workspaceIconPrepare).toContain('"status": "confirmation_required"')
      expect(workspaceIconPrepare).not.toContain('expectedReply')
      expect(setIcon).not.toHaveBeenCalled()
      iconAgent.session.events.push({
        seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '就用这个图标' }] },
      } as never)
      await expect(iconTool?.execute?.(
        { action: 'confirm' }, { agent: iconAgent, callId: 'call-workspace-icon-confirm' },
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
        { action: 'prepare', extension_id: 'ext-1', workspace_path: join(outside, 'icon.svg') }, exec,
      )).rejects.toThrow('absolute paths are not allowed')
      await expect(iconTool?.execute?.(
        { action: 'prepare', extension_id: 'ext-1', workspace_path: '../icon.svg' }, exec,
      )).rejects.toThrow('path traversal is not allowed')
      await expect(iconTool?.execute?.(
        { action: 'prepare', extension_id: 'ext-1', workspace_path: 'escaped/icon.svg' }, exec,
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

      await expect(iconTool?.execute?.({ action: 'prepare', extension_id: 'ext-1' }, exec))
        .rejects.toThrow('provide exactly one of image_ref or workspace_path')
      await expect(iconTool?.execute?.({
        action: 'prepare', extension_id: 'ext-1', image_ref: 'arkme-ref', workspace_path: 'unsafe.svg',
      }, exec)).rejects.toThrow('provide exactly one of image_ref or workspace_path')
      await expect(iconTool?.execute?.(
        { action: 'prepare', extension_id: 'ext-1', workspace_path: 'unsafe.svg' }, exec,
      )).rejects.toThrow('SVG executable, embedded, linked, or external-resource elements are not allowed')
      await expect(iconTool?.execute?.(
        { action: 'prepare', extension_id: 'ext-1', workspace_path: 'styled.svg' }, exec,
      )).rejects.toThrow('SVG links, styles, event handlers, and processing instructions are not allowed')
      const controller = new AbortController()
      controller.abort(new Error('cancelled by test'))
      await expect(iconTool?.execute?.(
        { action: 'prepare', extension_id: 'ext-1', workspace_path: 'safe.svg' }, { ...exec, signal: controller.signal },
      )).rejects.toThrow('cancelled by test')
      expect(setIcon).not.toHaveBeenCalled()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
