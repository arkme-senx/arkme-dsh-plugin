import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../../src/host-api.js'

describe('extension center Host BFF', () => {
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
    const search = vi.fn(async () => ({ items: [{ extension_id: 'ext-1', name: '扩展' }], total: 1 }))
    await expect(dispatchArkmeHostOperation(
      {} as never,
      'extensions.catalog.list',
      { query: '天气', limit: 10 },
      undefined,
      { search } as never,
    )).resolves.toEqual({ items: [{ extension_id: 'ext-1', name: '扩展' }], total: 1 })
    expect(search).toHaveBeenCalledWith('天气', 10)
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

  it('resolves extension authors in the Host for public and owned details', async () => {
    const service = {
      extensionAuthors: vi.fn(async () => new Map([[77, { displayName: '发布者', arkmeId: 'publisher' }]])),
    }
    const inspect = vi.fn(async () => ({
      extension_id: 'ext-1', name: '扩展', description: '', visibility: 'public', owner_user_id: 77,
    }))
    const myList = vi.fn(async () => ({
      items: [{ extension_id: 'ext-1', name: '扩展', description: '', visibility: 'public', owner_user_id: 77 }],
      total: 1,
    }))

    await expect(dispatchArkmeHostOperation(
      service as never, 'extensions.catalog.detail', { extensionId: 'ext-1' }, undefined, { inspect } as never,
    )).resolves.toMatchObject({ owner_name: '发布者', owner_arkme_id: 'publisher' })
    await expect(dispatchArkmeHostOperation(
      service as never, 'extensions.my-list', {}, undefined, { myList } as never,
    )).resolves.toMatchObject({ items: [{ owner_name: '发布者', owner_arkme_id: 'publisher' }] })
    expect(service.extensionAuthors).toHaveBeenCalledWith([77])
  })

  it('routes author soft deletion through the authenticated Host manager', async () => {
    const deleteExtension = vi.fn(async () => ({
      extension_id: 'ext-owned', status: 'deleted', deleted_at: 1780000001123,
    }))

    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.delete', { extensionId: 'ext-owned' }, undefined, { delete: deleteExtension } as never,
    )).resolves.toEqual({ extension_id: 'ext-owned', status: 'deleted', deleted_at: 1780000001123 })
    expect(deleteExtension).toHaveBeenCalledWith('ext-owned')
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

  it('routes my-extension list and publish through the unified Host owner', async () => {
    const list = vi.fn(async () => ({ items: [], warnings: [] }))
    const publish = vi.fn(async () => ({ extension_id: 'ext-1', version: '1.0.0', status: 'published' }))
    const owner = { list, publish }

    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.mine.list', { currentSessionId: 'session-1' },
      undefined, undefined, undefined, owner as never,
    )).resolves.toEqual({ items: [], warnings: [] })
    await expect(dispatchArkmeHostOperation(
      {} as never, 'extensions.mine.publish', {
        ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
        visibility: 'private', changelog: 'first', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
      }, undefined, undefined, undefined, owner as never,
    )).resolves.toMatchObject({ status: 'published' })

    expect(list).toHaveBeenCalledWith({ currentSessionId: 'session-1' })
    expect(publish).toHaveBeenCalledWith({
      ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
      visibility: 'private', changelog: 'first', clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
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
