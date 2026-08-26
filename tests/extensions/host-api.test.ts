import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../../src/host-api.js'

describe('marketplace Host BFF', () => {
  it('requires same-origin requests for preview delete and reorder', async () => {
    const deletePreview = vi.fn(async () => ({ extension_id: 'ext-1', preview_images: [], preview_revision: 2 }))
    const reorderPreviews = vi.fn(async () => ({ extension_id: 'ext-1', preview_images: [], preview_revision: 3 }))
    const updateMetadata = vi.fn(async () => ({
      extension_id: 'ext-1', name: '新名称', description: '', visibility: 'private', updated_at: 1,
    }))
    let handler: ReturnType<typeof createArkmeHostApi>
    const server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing test port')
      const origin = `http://127.0.0.1:${String(address.port)}`
      handler = createArkmeHostApi({} as never, {
        expectedPort: address.port, allowNonLoopback: false,
        extensionManager: () => ({ deletePreview, reorderPreviews, updateMetadata }) as never,
      })
      const body = JSON.stringify({
        operation: 'extensions.preview.delete',
        params: { extensionId: 'ext-1', previewRef: `preview_v1_${'a'.repeat(64)}`, expectedRevision: 1 },
      })
      const missingOrigin = await fetch(`${origin}/api`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      })
      expect(missingOrigin.status).toBe(403)
      expect(deletePreview).not.toHaveBeenCalled()
      const allowed = await fetch(`${origin}/api`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
      })
      expect(allowed.status).toBe(200)
      expect(deletePreview).toHaveBeenCalledWith({
        extensionId: 'ext-1', previewRef: `preview_v1_${'a'.repeat(64)}`, expectedRevision: 1,
      })
      const metadataBody = JSON.stringify({
        operation: 'extensions.metadata.update',
        params: {
          extensionId: 'ext-1', name: '新名称', description: '', visibility: 'private',
          clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
        },
      })
      const metadataMissingOrigin = await fetch(`${origin}/api`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: metadataBody,
      })
      expect(metadataMissingOrigin.status).toBe(403)
      expect(updateMetadata).not.toHaveBeenCalled()
      const metadataAllowed = await fetch(`${origin}/api`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: metadataBody,
      })
      expect(metadataAllowed.status).toBe(200)
      expect(updateMetadata).toHaveBeenCalledWith({
        extensionId: 'ext-1', name: '新名称', description: '', visibility: 'private',
        clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
      })
      const profileSaveMissingOrigin = await fetch(`${origin}/api`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          operation: 'extensions.mine.persist',
          params: {
            ownedRef: 'owned-ref', name: '天气', description: '', version: '1.0.0',
            clientMutationId: '0acf8c13-4086-4d51-890d-4911ad886880',
          },
        }),
      })
      expect(profileSaveMissingOrigin.status).toBe(403)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('routes extension reviews through the always-available Arkme Host owner', async () => {
    const service = {
      listExtensionReviews: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
      createExtensionReview: vi.fn(async (input: unknown) => ({ review: { reviewRef: 'review-ref' }, input })),
    }

    await dispatchArkmeHostOperation(service as never, 'extensions.reviews.list', {
      extensionId: 'ext-1', limit: 20, offset: 0,
    })
    await dispatchArkmeHostOperation(service as never, 'extensions.reviews.create', {
      extensionId: 'ext-1', textContent: '很好用', rating: 5, clientMutationId: 'mutation-0001',
    })

    expect(service.listExtensionReviews).toHaveBeenCalledWith('ext-1', { limit: 20, offset: 0 })
    expect(service.createExtensionReview).toHaveBeenCalledWith({
      extensionId: 'ext-1', textContent: '很好用', rating: 5, clientMutationId: 'mutation-0001',
    })
  })

  it('fails loud when Dynamic Cordis is absent', async () => {
    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.installed-list',
      {},
    )).rejects.toMatchObject({ code: 'extension-runtime-unavailable', httpStatus: 503 })
  })

  it('keeps remote access in the Host manager and returns the safe projection', async () => {
    const searchCatalog = vi.fn(async () => ({ items: [{ extension_id: 'ext-1', name: '扩展' }], total: 1 }))
    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.catalog.list',
      { query: '天气', sort: 'rating', cursor: 'next', limit: 10 },
      undefined,
      { searchCatalog } as never,
    )).resolves.toEqual({ items: [{ extension_id: 'ext-1', name: '扩展' }], total: 1 })
    expect(searchCatalog).toHaveBeenCalledWith({ query: '天气', sort: 'rating', cursor: 'next', limit: 10 })
  })

  it('rejects stale persistent Client calls with a specific unavailable error before invoking Host handlers', async () => {
    const persistentClientState = vi.fn(() => ({
      extension_id: 'ext-1', version: '1.0.0', mount: false, reason: 'version-mismatch',
    }))

    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.persistent.invoke',
      { extensionId: 'ext-1', version: '1.0.0', method: 'read', args: null },
      undefined,
      { persistentClientState } as never,
    )).rejects.toMatchObject({
      code: 'extension-runtime-unavailable',
      message: '插件不可用，请重启 DSH 后重试',
      httpStatus: 409,
    })
    expect(persistentClientState).toHaveBeenCalledWith('ext-1', '1.0.0')
  })

  it('routes isolated Client failures to the exact installed extension owner', async () => {
    const reportClientFailure = vi.fn(async () => ({ handled: true, disabled: true }))

    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.client.failure',
      {
        identityKey: 'extensionId', extensionId: 'ext-1', version: '1.0.0',
        clientInstanceKey: `instance-v1-${'a'.repeat(64)}`,
        clientContentDigest: `client-v1-${'b'.repeat(64)}`,
        kind: 'runtime-load-failed', message: 'slot collision',
      },
      undefined,
      { reportClientFailure } as never,
    )).resolves.toEqual({ handled: true, disabled: true })
    expect(reportClientFailure).toHaveBeenCalledWith({
      identityKey: 'extensionId', extensionId: 'ext-1', version: '1.0.0',
      clientInstanceKey: `instance-v1-${'a'.repeat(64)}`,
      clientContentDigest: `client-v1-${'b'.repeat(64)}`,
      clientOwnerKey: '',
      kind: 'runtime-load-failed', message: 'slot collision',
    })
  })

  it('resolves a Bundle Client owner through the Host install store', async () => {
    const bundleClientState = vi.fn(() => ({
      extension_id: 'ext-1', version: '1.0.0', mount: true,
      instance_key: `instance-v1-${'a'.repeat(64)}`, generation: 7,
    }))

    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.bundle.client-state',
      {
        packageName: '@example/weather', version: '1.0.0',
        clientContentDigest: `client-v1-${'b'.repeat(64)}`,
      },
      undefined,
      { bundleClientState } as never,
    )).resolves.toMatchObject({ extension_id: 'ext-1', mount: true, generation: 7 })
    expect(bundleClientState).toHaveBeenCalledWith(
      '@example/weather', '1.0.0', `client-v1-${'b'.repeat(64)}`,
    )
  })

  it('routes user-triggered extension audit through the Host manager', async () => {
    const auditExtension = vi.fn(async () => ({
      extension_id: 'ext-1', trigger: 'market_detail', verdict: 'review', risk_level: 'medium',
      summary: '需要复核', reasons: ['声明较宽'], recommendations: [], source_reviewed: false,
      source_scope: 'public_detail_only', audited_at_millis: 1,
    }))
    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.audit.check',
      { extensionId: 'ext-1' },
      undefined,
      { auditExtension } as never,
    )).resolves.toMatchObject({ extension_id: 'ext-1', verdict: 'review' })
    expect(auditExtension).toHaveBeenCalledWith({ extensionId: 'ext-1', trigger: 'market_detail' })
  })

  it('routes AI category discovery and keeps server-side ordering active', async () => {
    const classificationTree = vi.fn(async () => ({
      status: 'ready', categories: [{ category_id: 'cat_tools', name: '工具', extension_count: 1 }],
      total_extensions: 1, total_categories: 1,
    }))
    const classificationItems = vi.fn(async () => ({
      category_id: 'cat_tools', items: [{ extension_id: 'ext-1', name: '扩展' }], total: 1, limit: 20, offset: 0,
    }))
    const manager = { classificationTree, classificationItems }

    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.classification.tree', { limit: 50 }, undefined, manager as never,
    )).resolves.toMatchObject({ status: 'ready', total_categories: 1 })
    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.classification.items', {
        categoryId: 'cat_tools', query: '天气', sort: 'opens', cursor: '20', limit: 20,
      }, undefined, manager as never,
    )).resolves.toMatchObject({ category_id: 'cat_tools', total: 1 })
    expect(classificationTree).toHaveBeenCalledWith(50)
    expect(classificationItems).toHaveBeenCalledWith({
      categoryId: 'cat_tools', query: '天气', sort: 'opens', cursor: '20', limit: 20,
    })
  })

  it('resolves extension authors in the Host for catalog, public details, and owned details', async () => {
    const service = {
      extensionAuthors: vi.fn(async () => new Map([[77, {
        displayName: '发布者', arkmeId: 'publisher', avatarRef: 'sealed-avatar-ref',
        avatarFallback: { kind: 'phone_default' as const, colorIndex: 3, label: '发' },
      }]])),
    }
    const searchCatalog = vi.fn(async () => ({
      items: [{ extension_id: 'ext-1', name: '扩展', description: '', visibility: 'public', owner_user_id: 77 }],
      total: 1,
    }))
    const inspect = vi.fn(async () => ({
      extension_id: 'ext-1', name: '扩展', description: '', visibility: 'public', owner_user_id: 77,
    }))
    const myList = vi.fn(async () => ({
      items: [{ extension_id: 'ext-1', name: '扩展', description: '', visibility: 'public', owner_user_id: 77 }],
      total: 1,
    }))

    await expect(dispatchArkmeHostOperation(
      service as never, 'extensions.catalog.list', {
        ownerUserId: 77,
        excludeExtensionId: 'ext-current',
        sort: 'opens',
        limit: 70,
      }, undefined, { searchCatalog } as never,
    )).resolves.toMatchObject({ items: [{
      owner_name: '发布者', owner_arkme_id: 'publisher', owner_avatar_ref: 'sealed-avatar-ref',
      owner_avatar_fallback: { kind: 'phone_default', colorIndex: 3, label: '发' },
    }] })
    expect(searchCatalog).toHaveBeenCalledWith({
      query: '',
      cursor: '',
      limit: 70,
      sort: 'opens',
      ownerUserId: 77,
      excludeExtensionId: 'ext-current',
    })
    await expect(dispatchArkmeHostOperation(
      service as never, 'extensions.catalog.detail', { extensionId: 'ext-1' }, undefined, { inspect } as never,
    )).resolves.toMatchObject({
      owner_name: '发布者', owner_arkme_id: 'publisher', owner_avatar_ref: 'sealed-avatar-ref',
      owner_avatar_fallback: { kind: 'phone_default', colorIndex: 3, label: '发' },
    })
    await expect(dispatchArkmeHostOperation(
      service as never, 'extensions.my-list', {}, undefined, { myList } as never,
    )).resolves.toMatchObject({ items: [{
      owner_name: '发布者', owner_arkme_id: 'publisher', owner_avatar_ref: 'sealed-avatar-ref',
      owner_avatar_fallback: { kind: 'phone_default', colorIndex: 3, label: '发' },
    }] })
    expect(service.extensionAuthors).toHaveBeenCalledTimes(3)
    expect(service.extensionAuthors).toHaveBeenCalledWith([77])
  })

  it('does not resolve Jotmo author identity for imported or legacy GitHub entries', async () => {
    const service = { extensionAuthors: vi.fn(async () => new Map()) }
    const source = {
      type: 'github_repository' as const,
      url: 'https://github.com/example/imported',
      label: 'GitHub',
      verification: 'publisher_attested' as const,
    }
    const searchCatalog = vi.fn(async () => ({
      items: [
        { extension_id: 'ext-importer', name: '导入扩展', description: '', visibility: 'public' as const, owner_user_id: 77, publisher_role: 'importer' as const, source },
        { extension_id: 'ext-legacy', name: '历史导入', description: '', visibility: 'public' as const, owner_user_id: 88, source },
      ],
      total: 2,
    }))

    await expect(dispatchArkmeHostOperation(
      service as never, 'extensions.catalog.list', {}, undefined, { searchCatalog } as never,
    )).resolves.toMatchObject({ items: [
      { extension_id: 'ext-importer', publisher_role: 'importer' },
      { extension_id: 'ext-legacy' },
    ] })
    expect(service.extensionAuthors).not.toHaveBeenCalled()
  })

  it('routes complete author deletion through the owned-inventory lifecycle owner', async () => {
    const deleteExtension = vi.fn(async () => ({
      extension_id: 'ext-owned', status: 'deleted', deleted_at: 1780000001123, installed: false, active: false,
      references_removed: true, removed_source_count: 1, restart_required: false, message: '扩展已完全移除',
    }))

    const signal = new AbortController().signal
    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.delete', { extensionId: 'ext-owned' }, undefined, undefined, undefined,
      { delete: deleteExtension } as never, signal,
    )).resolves.toMatchObject({ extension_id: 'ext-owned', status: 'deleted', references_removed: true })
    expect(deleteExtension).toHaveBeenCalledWith({ extensionId: 'ext-owned', signal })
  })

  it('routes author unpublish without invoking the permanent delete lifecycle', async () => {
    const unpublishExtension = vi.fn(async () => ({
      extension_id: 'ext-owned', status: 'suspended', unpublished_at: 1780000001123,
    }))

    const signal = new AbortController().signal
    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.unpublish', { extensionId: 'ext-owned' }, undefined, undefined, undefined,
      { unpublish: unpublishExtension } as never, signal,
    )).resolves.toMatchObject({ extension_id: 'ext-owned', status: 'suspended' })
    expect(unpublishExtension).toHaveBeenCalledWith({ extensionId: 'ext-owned', signal })
  })

  it('routes metadata editing through the authenticated Host manager', async () => {
    const updateMetadata = vi.fn(async () => ({
      extension_id: 'ext-owned', name: '新名称', description: '', visibility: 'public', updated_at: 2,
    }))
    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.metadata.update',
      {
        extensionId: 'ext-owned', name: '新名称', description: '', visibility: 'public',
        clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
      },
      undefined,
      { updateMetadata } as never,
    )).resolves.toMatchObject({ name: '新名称', visibility: 'public' })
  })

	it('routes share rotation through the authenticated Host manager', async () => {
		const rotateShareLink = vi.fn(async () => ({
			ref: 'extshare_0123456789abcdef0123456789abcdef',
			url: 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef',
		}))
		await expect(dispatchArkmeHostOperation(
			{} as never,
			'extensions.share.rotate',
			{ extensionId: 'ext-owned', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432' },
			undefined,
			{ rotateShareLink } as never,
		)).resolves.toMatchObject({ ref: 'extshare_0123456789abcdef0123456789abcdef' })
		expect(rotateShareLink).toHaveBeenCalledWith({
			extensionId: 'ext-owned', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
		})
	})

	it('routes link-scoped share detail through the same Host manager', async () => {
		const readSharedDetail = vi.fn(async () => ({
			name: '天气', description: '', visibility: 'private', share_scope: 'link_readonly',
			latest_stable_version: '1.0.0', preview_images: [],
			rating_summary: { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] },
		}))
		await expect(dispatchArkmeHostOperation(
			{} as never,
			'extensions.share.detail',
			{ shareRef: 'extshare_0123456789abcdef0123456789abcdef' },
			undefined,
			{ readSharedDetail } as never,
		)).resolves.toMatchObject({ name: '天气', share_scope: 'link_readonly' })
		expect(readSharedDetail).toHaveBeenCalledWith('extshare_0123456789abcdef0123456789abcdef')
	})

  it('routes my-extension list, Profile save, and publish through the unified Host owner', async () => {
    const list = vi.fn(async () => ({ items: [], warnings: [] }))
    const saveToProfile = vi.fn(async () => ({
      packageName: '@arkme-generated/weather', version: '1.0.0', artifactContractVersion: 2,
      artifactKind: 'dsh-bundle-tgz', installed: true, active: false, restartRequired: true, message: 'saved',
    }))
    const publish = vi.fn(async () => ({ extension_id: 'ext-1', version: '1.0.0', status: 'published' }))
    const owner = { list, saveToProfile, publish }
    const signal = new AbortController().signal

    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.mine.list', { currentSessionId: 'session-1' },
      undefined, undefined, undefined, owner as never, signal,
    )).resolves.toEqual({ items: [], warnings: [] })
    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.mine.persist', {
        ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
        clientMutationId: '0acf8c13-4086-4d51-890d-4911ad886880',
      }, undefined, undefined, undefined, owner as never,
    )).resolves.toMatchObject({ artifactContractVersion: 2, installed: true, restartRequired: true })
    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.mine.publish', {
        ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
        visibility: 'private', changelog: 'first', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
      }, undefined, undefined, undefined, owner as never, signal,
    )).resolves.toMatchObject({ status: 'published' })

    expect(list).toHaveBeenCalledWith({ currentSessionId: 'session-1', signal })
    expect(saveToProfile).toHaveBeenCalledWith({
      ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
      clientMutationId: '0acf8c13-4086-4d51-890d-4911ad886880',
    })
    expect(publish).toHaveBeenCalledWith({
      ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
      visibility: 'private', changelog: 'first', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432', signal,
    })
  })

  it('starts and reads a Host-owned install task without exposing the artifact URL', async () => {
    const start = vi.fn(() => ({ taskId: 'task-1', phase: 'resolving' }))
    const status = vi.fn(() => ({ taskId: 'task-1', phase: 'downloading', downloadedBytes: 7, totalBytes: 10 }))
    const tasks = { start, status }

    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.install.start',
      { extensionId: 'ext-1', version: '1.0.0', sessionId: 'session-1' },
      undefined,
      undefined,
      tasks as never,
    )).resolves.toEqual({ taskId: 'task-1', phase: 'resolving' })
    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.install.status',
      { taskId: 'task-1', sessionId: 'session-1' },
      undefined,
      undefined,
      tasks as never,
    )).resolves.toMatchObject({ downloadedBytes: 7, totalBytes: 10 })
    expect(start).toHaveBeenCalledWith({ extensionId: 'ext-1', version: '1.0.0', sessionId: 'session-1' })
    expect(status).toHaveBeenCalledWith('task-1', 'session-1')
  })

  it('uses the authenticated resolver for a private install preview and keeps signed URLs Host-only', async () => {
    const previewInstall = vi.fn(async () => ({
      extension_id: 'ext-private', version: '1.2.3', artifact_size: 42,
      manifest: { name: '私有扩展', permissions: ['records.search'] }, revoked: false,
    }))

    const result = await dispatchArkmeHostOperation(
      {} as never,
      'extensions.install.preview',
      { extensionId: 'ext-private' },
      undefined,
      { previewInstall } as never,
    )

    expect(previewInstall).toHaveBeenCalledWith('ext-private', undefined)
    expect(result).toMatchObject({ extension_id: 'ext-private', version: '1.2.3', artifact_size: 42 })
    expect(result).not.toHaveProperty('artifact_url')
    expect(result).not.toHaveProperty('artifact_headers')
    expect(result).not.toHaveProperty('signature')
  })

  it('routes pause, resume, and uninstall through the Host task owner', async () => {
    const pause = vi.fn(() => ({ phase: 'paused' }))
    const resume = vi.fn(() => ({ phase: 'resolving' }))
    const uninstall = vi.fn(async () => ({ installed: false }))
    const restart = vi.fn(async () => ({ restarting: true }))
    const tasks = { pause, resume, uninstall, restart }
    for (const operation of ['extensions.install.pause', 'extensions.install.resume'] as const) {
      await dispatchArkmeHostOperation(
        {} as never, operation, { taskId: 'task-1', sessionId: 'session-1' },
        undefined, undefined, tasks as never,
      )
    }
    await dispatchArkmeHostOperation(
      {} as never, 'extensions.uninstall', { extensionId: 'ext-1', sessionId: 'session-1' },
      undefined, undefined, tasks as never,
    )
    await dispatchArkmeHostOperation(
      {} as never, 'extensions.restart', { extensionId: 'ext-1' },
      undefined, undefined, tasks as never,
    )
    expect(pause).toHaveBeenCalledWith('task-1', 'session-1')
    expect(resume).toHaveBeenCalledWith('task-1', 'session-1')
    expect(uninstall).toHaveBeenCalledWith({ extensionId: 'ext-1', sessionId: 'session-1' })
    expect(restart).toHaveBeenCalledWith('ext-1')
  })

  it('routes desired enabled state through the same Host task owner', async () => {
    const setEnabled = vi.fn(async () => ({
      extension_id: 'ext-1', installed: true, enabled: false, active: false, restart_required: true,
    }))
    const tasks = { setEnabled }
    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.enabled.set',
      { extensionId: 'ext-1', enabled: false },
      undefined, tasks as never,
    )).resolves.toMatchObject({ enabled: false, restart_required: true })
    expect(setEnabled).toHaveBeenCalledWith({
      agent: undefined, extensionId: 'ext-1', enabled: false,
    })
  })
})
