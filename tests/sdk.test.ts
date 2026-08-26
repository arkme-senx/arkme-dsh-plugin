import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmeSdk, ArkmeClientError } from '../src/sdk/index.js'
import type {
  ArkmeOutgoingCallIntentClaim,
  ArkmeOutgoingCallPrepareResult,
  ArkmeOutgoingCallToolResult,
} from '../src/index.js'
import type { ArkmeProviderState } from '../src/types.js'

function success(value: unknown): Response {
  return new Response(JSON.stringify({ ok: true, value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => { vi.useRealTimers() })

describe('Arkme SDK', () => {
  it('manages account-scoped favorite stickers through the public typed SDK', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        return success({ items: [], itemCount: 0, updatedAtMillis: 1 })
      },
    })

    await expect(sdk.manageFavoriteSticker('asset-12345678', 'move-to-front')).resolves.toMatchObject({ itemCount: 0 })
    expect(calls).toEqual([{
      operation: 'favorite-stickers.manage', params: { fileAssetUid: 'asset-12345678', action: 'move-to-front' },
    }])
    await expect(sdk.manageFavoriteSticker(' ', 'delete')).rejects.toThrow(/must not be empty/)
  })

  it('uploads World images as raw files and keeps text and file-asset publish operations separate', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/upload')) {
        expect(init?.body).toBeInstanceOf(Blob)
        expect(new Headers(init?.headers).get('x-arkme-file-name')).toBe('a.png')
        return success({ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 4, fileKind: 1 })
      }
      const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
      calls.push(request)
      return success({
        recordSaved: true, recordState: 'synced', worldPublished: true,
        visibility: 'visible', checkStatus: 2, retryable: false,
      })
    })
    const sdk = createArkmeSdk({ fetchImpl: fetchImpl as typeof fetch })
    const mutationId = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'
    const asset = await sdk.upload(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), { fileName: 'a.png' })

    await sdk.publishWorldText({ clientMutationId: mutationId, textContent: '文字正文' })
    await sdk.publishWorldFileAssets({ clientMutationId: mutationId, textContent: '图片正文', fileAssets: [{ ...asset, fileKind: 1 }] })

    expect(calls).toEqual([
      { operation: 'world.publish-text', params: { clientMutationId: mutationId, textContent: '文字正文' } },
      { operation: 'world.publish-file-assets', params: {
        clientMutationId: mutationId,
        textContent: '图片正文',
        fileAssets: [{ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 4, fileKind: 1 }],
      } },
    ])
  })

  it('lists image-library pages through the public same-origin operation', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        return success({ items: [], hasMore: false, queryGuard: { state: 'complete' } })
      },
    })

    await expect(sdk.images({ limit: 24, cursor: 'next-images' })).resolves.toMatchObject({ hasMore: false })
    expect(calls).toEqual([{ operation: 'images.list', params: { limit: 24, cursor: 'next-images' } }])
  })

  it('searches and adds contacts through opaque same-origin contracts', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'contacts.search') return success({
          contactRef: 'arkme-contact-v1.9f445b4f-55aa-45c1-9250-25161832d432', identifierKind: 'arkme_id',
          displayName: '林林', registered: true, inviteBySms: false, canAdd: true, isSelf: false,
        })
        if (request.operation === 'contacts.add') return success({
          state: 'ready', source: { sourceRef: 'source-ref', kind: 'private_chat', displayName: '林林', activeAtMillis: 1, unreadCount: 0 },
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })
    const candidate = await sdk.searchContact('lin-lin')
    await expect(sdk.addContact(candidate.contactRef, {
      remark: '同事', requestUid: '9f445b4f-55aa-45c1-9250-25161832d433',
    })).resolves.toMatchObject({ state: 'ready' })
    expect(calls).toEqual([
      { operation: 'contacts.search', params: { identifier: 'lin-lin' } },
      { operation: 'contacts.add', params: {
        contactRef: candidate.contactRef, remark: '同事', requestUid: '9f445b4f-55aa-45c1-9250-25161832d433',
      } },
    ])
  })

  it('opens a searched contact private chat through the public SDK without adding contacts', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'chat.private.open-from-contact') return success({
          source: { sourceRef: 'source-ref', kind: 'private_chat', displayName: '木白', activeAtMillis: 1, unreadCount: 0 },
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.openPrivateChatFromContact('arkme-contact-v1.9f445b4f-55aa-45c1-9250-25161832d432'))
      .resolves.toMatchObject({ source: { sourceRef: 'source-ref', displayName: '木白' } })
    expect(calls).toEqual([
      {
        operation: 'chat.private.open-from-contact',
        params: { contactRef: 'arkme-contact-v1.9f445b4f-55aa-45c1-9250-25161832d432' },
      },
    ])
  })

  it('reads call history and retries summaries through same-origin opaque refs', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'calls.history.list') return success({
          items: [{ callRef: 'arkme-call-v1.payload.sig', peerDisplayName: '林林', mediaType: 'audio' }],
          hasMore: false,
        })
        if (request.operation === 'calls.history.detail') return success({
          callRef: 'arkme-call-v1.payload.sig',
          title: '通话详情',
          mediaType: 'video',
          videoRecord: {
            available: true,
            source: 'real',
            videoUrl: 'https://media.example/real-call.mp4',
            posterUrl: 'https://media.example/real-call.jpg',
          },
          participants: [],
          transcriptSegments: [],
        })
        if (request.operation === 'calls.history.summary.retry') return success({
          status: 'submitted',
          detail: { callRef: 'arkme-call-v1.payload.sig', title: '通话详情', mediaType: 'audio' },
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await sdk.callHistory({ limit: 5, cursor: ' next ', includeRecentContacts: false })
    const detail = await sdk.callDetail(' arkme-call-v1.payload.sig ')
    expect(detail).toMatchObject({
      videoRecord: { available: true, source: 'real' },
    })
    expect(JSON.stringify(detail)).not.toContain('media.example')
    await sdk.retryCallSummary(' arkme-call-v1.payload.sig ')

    expect(calls).toEqual([
      { operation: 'calls.history.list', params: { limit: 5, cursor: 'next', includeRecentContacts: false } },
      { operation: 'calls.history.detail', params: { callRef: 'arkme-call-v1.payload.sig' } },
      { operation: 'calls.history.summary.retry', params: { callRef: 'arkme-call-v1.payload.sig' } },
    ])
  })

  it('creates groups and Bots through safe same-origin contracts', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'group.create') return success({
          sourceRef: 'group-source', kind: 'group_chat', displayName: '项目群', activeAtMillis: 1, unreadCount: 0,
        })
        if (request.operation === 'bots.create') return success({
          botRef: 'bot-ref', name: '总结助手', provider: 'openclaw', description: '',
          status: 'offline', directChatAvailable: false,
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })
    const mutationId = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'
    await expect(sdk.createGroup(' 项目群 ', { clientMutationId: mutationId }))
      .resolves.toMatchObject({ kind: 'group_chat' })
    await expect(sdk.createBot({
      name: ' 总结助手 ', provider: 'openclaw', avatar: 'file_asset://avatar-asset-1',
    }))
      .resolves.toMatchObject({ botRef: 'bot-ref' })
    expect(calls).toEqual([
      { operation: 'group.create', params: { title: '项目群', clientMutationId: mutationId } },
      { operation: 'bots.create', params: {
        name: '总结助手', provider: 'openclaw', avatar: 'file_asset://avatar-asset-1',
      } },
    ])
    await expect(sdk.createBot({
      name: '错误头像', provider: 'openclaw', avatar: 'https://untrusted.example/avatar.png',
    })).rejects.toThrow('file_asset reference')
  })

  it('manages extension previews through same-origin Host operations', async () => {
    const previewRef = `preview_v1_${'a'.repeat(64)}`
    const secondRef = `preview_v1_${'b'.repeat(64)}`
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/extension-preview/upload')) {
        expect(init?.method).toBe('POST')
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        return success({
          extension_id: 'ext-1', applied_preview_ref: previewRef,
          preview_images: [{ preview_ref: previewRef, content_type: 'image/png', preview_size: 4, width: 640, height: 480, created_at: 1 }],
          preview_revision: 1,
        })
      }
      const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
      calls.push(request)
      if (request.operation === 'extensions.preview.delete') return success({
        extension_id: 'ext-1', preview_images: [], preview_revision: 2,
      })
      if (request.operation === 'extensions.preview.reorder') return success({
        extension_id: 'ext-1',
        preview_images: [
          { preview_ref: secondRef, content_type: 'image/png', preview_size: 5, width: 800, height: 600, created_at: 2 },
          { preview_ref: previewRef, content_type: 'image/png', preview_size: 4, width: 640, height: 480, created_at: 1 },
        ],
        preview_revision: 3,
      })
      throw new Error(`unexpected ${request.operation}`)
    })
    const sdk = createArkmeSdk({ fetchImpl: fetchImpl as typeof fetch })
    await expect(sdk.addExtensionPreview(
      'ext-1', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
      { clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432' },
    )).resolves.toMatchObject({ applied_preview_ref: previewRef, preview_revision: 1 })
    await expect(sdk.deleteExtensionPreview('ext-1', previewRef, 1)).resolves.toMatchObject({ preview_revision: 2 })
    await expect(sdk.reorderExtensionPreviews('ext-1', [secondRef, previewRef], 2)).resolves.toMatchObject({ preview_revision: 3 })
    expect(sdk.extensionPreviewUrl('ext-1', previewRef))
      .toBe(`/arkme-self/api/extension-preview?extension_id=ext-1&preview_ref=${previewRef}`)
    expect(calls).toEqual([
      { operation: 'extensions.preview.delete', params: { extensionId: 'ext-1', previewRef, expectedRevision: 1 } },
      { operation: 'extensions.preview.reorder', params: { extensionId: 'ext-1', orderedPreviewRefs: [secondRef, previewRef], expectedRevision: 2 } },
    ])
  })

  it('uploads owned extension icons through same-origin Host without signed URLs', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/arkme-self/api/extension-icon/upload')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('x-arkme-extension-id')).toBe('ext-1')
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
      return success({
        icon_upload_session_id: 'iconup-1', extension_id: 'ext-1', status: 'applied',
        icon_ref: `icon_v1_${'a'.repeat(64)}`, content_type: 'image/png', icon_size: 4,
        icon_sha256: 'a'.repeat(64), updated_at: 1,
      })
    })
    const sdk = createArkmeSdk({ fetchImpl: fetchImpl as typeof fetch })
    await expect(sdk.setExtensionIcon(
      'ext-1', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
      { clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432' },
    )).resolves.toMatchObject({ status: 'applied' })
    expect(sdk.extensionIconUrl('ext-1', `icon_v1_${'a'.repeat(64)}`))
      .toBe(`/arkme-self/api/extension-icon?extension_id=ext-1&icon_ref=icon_v1_${'a'.repeat(64)}`)
  })

  it('exposes installed extensions and desired enable state without raw Profile paths', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const installed = [{
      extensionId: 'ext-1', installedVersion: '1.0.0', manifest: { name: '故障扩展' },
      enabled: false, active: false, permissionSnapshot: [], updateChannel: 'stable',
      installedAtMillis: 1, lastCheckedAtMillis: 1,
      unavailable: { code: 'runtime-load-failed', message: '插件运行失败，已自动停用。' },
    }]
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'extensions.installed-list') return success(installed)
        if (request.operation === 'extensions.enabled.set') return success({
          extension_id: 'ext-1', installed: true, enabled: false, active: false,
          restart_required: true, message: '已关闭',
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.installedExtensions()).resolves.toEqual(installed)
    await expect(sdk.setExtensionEnabled('ext-1', false)).resolves.toMatchObject({ enabled: false })
    expect(calls).toEqual([
      { operation: 'extensions.installed-list' },
      { operation: 'extensions.enabled.set', params: { extensionId: 'ext-1', enabled: false } },
    ])
  })

  it('deletes an owned extension through the complete Host lifecycle contract', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        return success({
          extension_id: 'ext-owned', status: 'deleted', deleted_at: 1780000001123,
          installed: false, active: false, references_removed: true, removed_source_count: 2,
          restart_required: true, message: '扩展已删除；服务端保留可恢复数据，当前 DSH 重启后完成本地移除',
        })
      },
    })

    await expect(sdk.deleteExtension(' ext-owned ')).resolves.toMatchObject({
      status: 'deleted', references_removed: true, restart_required: true,
    })
    expect(calls).toEqual([{ operation: 'extensions.delete', params: { extensionId: 'ext-owned' } }])
    await expect(sdk.deleteExtension(' ')).rejects.toThrow('must not be empty')
  })

  it('queries V3 market detail and native install capabilities through the public SDK', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'extensions.catalog.list') return success({ items: [], total: 0 })
        if (request.operation === 'extensions.catalog.detail') return success({
          extension_id: 'ext-v3', name: 'Native V3', description: '', visibility: 'public',
          artifact_contract_version: 3, native_capabilities: ['bin', 'runtime_dependencies'],
        })
        if (request.operation === 'extensions.install.preview') return success({
          extension_id: 'ext-v3', version: '1.0.0', artifact_contract_version: 3,
          artifact_kind: 'dsh-native-package-tgz', execution_model: 'dsh-native',
          native_capabilities: ['bin', 'runtime_dependencies'], requires_native_confirmation: true,
          manifest: {}, revoked: false,
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.searchExtensions('native', 10)).resolves.toMatchObject({ total: 0 })
    await expect(sdk.extensionCatalog({
      ownerUserId: 77,
      excludeExtensionId: 'ext-current',
      sort: 'comments',
      limit: 70,
    })).resolves.toMatchObject({ total: 0 })
    await expect(sdk.extensionDetail('ext-v3')).resolves.toMatchObject({ artifact_contract_version: 3 })
    await expect(sdk.extensionInstallPreview('ext-v3', '1.0.0')).resolves.toMatchObject({
      artifact_contract_version: 3, native_capabilities: ['bin', 'runtime_dependencies'],
    })
    expect(calls).toEqual([
      { operation: 'extensions.catalog.list', params: { query: 'native', limit: 10 } },
      {
        operation: 'extensions.catalog.list',
        params: { sort: 'comments', limit: 70, ownerUserId: 77, excludeExtensionId: 'ext-current' },
      },
      { operation: 'extensions.catalog.detail', params: { extensionId: 'ext-v3' } },
      { operation: 'extensions.install.preview', params: { extensionId: 'ext-v3', version: '1.0.0' } },
    ])
  })

  it('binds the default browser fetch to the global receiver', async () => {
    const originalFetch = globalThis.fetch
    const receiverFetch = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis)
      return Promise.resolve(success({ status: 'logged-out', environment: 'test' }))
    }) as unknown as typeof fetch
    globalThis.fetch = receiverFetch
    try {
      const sdk = createArkmeSdk()
      await expect(sdk.authStatus()).resolves.toMatchObject({ status: 'logged-out' })
      expect(receiverFetch).toHaveBeenCalledOnce()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('encapsulates the Provider route and validates the contract version', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'provider.capabilities') {
          return success({
            contractVersion: 1,
            provider: '@senguoyun/dsh-arkme',
            sdk: '@senguoyun/dsh-arkme/sdk',
            environment: 'test',
            features: {
              authStatus: true, cachedSnapshot: true, remoteRefresh: true, search: true,
              createText: true, retryOutbox: true, revisionPolling: true, userProfile: true, imageRead: true,
              recordCalendar: true,
              sourceDirectory: true, sourceTimeline: true, sourceTextSend: true, outgoingCall: true,
              extensionManagement: true,
              extensionIcons: true,
            },
            limits: { maxTextLength: 20_000, maxSearchResults: 30, maxSyncPages: 20, maxImageBytes: 2_097_152 },
          })
        }
        if (request.operation === 'records.search') {
          return success({ items: [], cacheComplete: true, cachedAtMillis: 1, revision: 4 })
        }
        if (request.operation === 'user.profile.refresh') {
          return success({
            profile: {
              userId: 1, displayName: '昵称', nickname: '昵称', avatarRef: '', arkmeId: 'arkme-id',
              accountType: 1, createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
            },
            cachedAtMillis: 1,
            revision: 5,
          })
        }
        if (request.operation === 'image.read') {
          return success({ mediaType: 'image/png', bytes: 8, dataBase64: 'iVBORw0KGgo=' })
        }
        if (request.operation === 'calendar.buckets') {
          return success({ scope: 'self', startDate: '2026-08-01', endDate: '2026-08-31', timezone: 'Asia/Shanghai', refreshedAtMillis: 1, days: [] })
        }
        if (request.operation === 'calendar.records') {
          return success({ scope: 'self', bucketDate: '2026-08-21', timezone: 'Asia/Shanghai', refreshedAtMillis: 1, items: [], hasMore: false })
        }
        if (request.operation === 'records.create') return success({ recordUid: request.params?.recordUid, status: 1 })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.capabilities()).resolves.toMatchObject({
      contractVersion: 1,
      features: { outgoingCall: true, extensionManagement: true, extensionIcons: true },
    })
    await expect(sdk.search('复盘', { limit: 5, syncAll: true })).resolves.toMatchObject({ revision: 4 })
    await expect(sdk.profile({ refresh: true })).resolves.toMatchObject({
      profile: { displayName: '昵称' }, revision: 5,
    })
    const image = await sdk.readImage('1_1700000000_1_0.png')
    expect(image).toMatchObject({ mediaType: 'image/png', bytes: 8 })
    expect(sdk.imageDataUrl(image)).toBe('data:image/png;base64,iVBORw0KGgo=')
    await expect(sdk.calendarBuckets({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      timezone: 'Asia/Shanghai',
    })).resolves.toMatchObject({ scope: 'self', days: [] })
    await expect(sdk.calendarRecords({
      bucketDate: '2026-08-21',
      timezone: 'Asia/Shanghai',
      limit: 10,
      cursor: { sendAtMillis: 1_787_300_000_000, recordUid: 'record-next' },
    })).resolves.toMatchObject({ scope: 'self', hasMore: false })
    await expect(sdk.createText('保存内容', { recordUid: 'a5d8df82-5b62-5b22-8f76-916a751ad63c' }))
      .resolves.toMatchObject({ status: 1 })
    expect(calls).toMatchObject([
      { operation: 'provider.capabilities' },
      { operation: 'records.search', params: { query: '复盘', limit: 5, syncAll: true } },
      { operation: 'user.profile.refresh' },
      { operation: 'image.read', params: { imageRef: '1_1700000000_1_0.png' } },
      { operation: 'calendar.buckets', params: { startDate: '2026-08-01', endDate: '2026-08-31', timezone: 'Asia/Shanghai' } },
      {
        operation: 'calendar.records',
        params: {
          bucketDate: '2026-08-21',
          timezone: 'Asia/Shanghai',
          limit: 10,
          cursor: { sendAtMillis: 1_787_300_000_000, recordUid: 'record-next' },
        },
      },
      {
        operation: 'records.create',
        params: { recordUid: 'a5d8df82-5b62-5b22-8f76-916a751ad63c', textContent: '保存内容' },
      },
    ])
    expect(() => createArkmeSdk({ route: 'https://example.com/api' })).toThrow(/same-origin/)
  })

  it('exposes unified source directory, timeline, and send operations', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'sources.list') return success({ directory: 'root', items: [], hasMore: false })
        if (request.operation === 'source.timeline') return success({
          source: { sourceRef: 'source-1', kind: 'private_chat', displayName: '小林', activeAtMillis: 0, unreadCount: 0 },
          items: [], hasMore: false,
        })
        if (request.operation === 'source.members') return success({
          source: { sourceRef: 'source-1' }, items: [{ memberRef: 'member-1', displayName: '小林' }], total: 1, activeCount: 1,
          joinEvents: [{
            eventId: 'join-1', action: 'invite', occurredAtMillis: 1,
            inviter: { memberRef: 'member-1', displayName: '小林', isSelf: false },
            invitees: [{ memberRef: 'member-2', displayName: '小张', isSelf: false }],
          }],
        })
        if (request.operation === 'source.member-records') return success({
          source: { sourceRef: 'source-1' }, member: { memberRef: 'member-1', displayName: '小林' },
          mode: 'mentioned', items: [], hasMore: false,
        })
        if (request.operation === 'source.send-text') return success({
          sourceRef: 'source-1', itemUid: request.params?.recordUid, status: 1, localState: 'synced',
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.listSources('root')).resolves.toMatchObject({ directory: 'root' })
    await expect(sdk.readSource('source-1')).resolves.toMatchObject({ source: { displayName: '小林' } })
    await expect(sdk.listSourceMembers('source-1')).resolves.toMatchObject({
      activeCount: 1, joinEvents: [{ eventId: 'join-1', action: 'invite' }],
    })
    await expect(sdk.sourceMemberRecords('source-1', 'member-1', 'mentioned', { limit: 12, beforeSequence: 44 }))
      .resolves.toMatchObject({ mode: 'mentioned' })
    await expect(sdk.sendText('source-1', '你好', { recordUid: 'record-1', relationUid: 'rel-1' }))
      .resolves.toMatchObject({ itemUid: 'record-1' })
    await expect(sdk.sendText('source-1', '代发', {
      recordUid: 'record-agent-1',
      relationUid: 'rel-agent-1',
      agentAuthored: true,
    })).resolves.toMatchObject({ itemUid: 'record-agent-1' })
    await expect(sdk.sendText('source-1', '@小林 请看', {
      recordUid: 'record-mention-1', relationUid: 'rel-mention-1',
      humanMentions: [{ memberRef: 'member-1', startIndex: 0, length: 3 }],
    })).resolves.toMatchObject({ itemUid: 'record-mention-1' })
    expect(calls).toMatchObject([
      { operation: 'sources.list', params: { directory: 'root' } },
      { operation: 'source.timeline', params: { sourceRef: 'source-1' } },
      { operation: 'source.members', params: { sourceRef: 'source-1', activeOnly: true } },
      {
        operation: 'source.member-records',
        params: { sourceRef: 'source-1', memberRef: 'member-1', mode: 'mentioned', limit: 12, beforeSequence: 44 },
      },
      { operation: 'source.send-text', params: { sourceRef: 'source-1', textContent: '你好', recordUid: 'record-1', relationUid: 'rel-1' } },
      {
        operation: 'source.send-text',
        params: {
          sourceRef: 'source-1',
          textContent: '代发',
          recordUid: 'record-agent-1',
          relationUid: 'rel-agent-1',
          agentAuthored: true,
        },
      },
      {
        operation: 'source.send-text',
        params: {
          sourceRef: 'source-1',
          textContent: '@小林 请看',
          recordUid: 'record-mention-1',
          relationUid: 'rel-mention-1',
          humanMentions: [{ memberRef: 'member-1', startIndex: 0, length: 3 }],
        },
      },
    ])
  })

  it('exposes group candidate discovery and member addition without raw user IDs', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'group.member-candidates') return success({ items: [], total: 0, hasMore: false, mode: 'direct_add' })
        if (request.operation === 'group.invite-preview') return success({ source: { sourceRef: 'group-ref' }, title: '群聊', inviterDisplayName: '发起人', inviteLink: 'https://example.test/invite', expireAtMillis: 1, mode: 'direct_add' })
        if (request.operation === 'group.members.add') return success({ sourceRef: 'group-ref', mode: 'direct_add', items: [], addedCount: 0, invitedCount: 0, failedCount: 0 })
        if (request.operation === 'group.bots') return success({ groupSourceRef: 'group-ref', displayName: '群聊', canAddBots: true, items: [] })
        if (request.operation === 'group.bot.add') return success({ groupSourceRef: 'group-ref', botRef: 'bot-ref', installed: true })
        throw new Error(`unexpected ${request.operation}`)
      },
    })
    await expect(sdk.listGroupMemberCandidates('group-ref', { query: '林', limit: 10 })).resolves.toMatchObject({ mode: 'direct_add' })
    await expect(sdk.groupInvitePreview('group-ref')).resolves.toMatchObject({ title: '群聊' })
    await expect(sdk.addGroupMembers('group-ref', [' candidate-ref '])).resolves.toMatchObject({ sourceRef: 'group-ref' })
    await expect(sdk.listGroupBots('group-ref')).resolves.toMatchObject({ canAddBots: true })
    await expect(sdk.addGroupBot('group-ref', 'bot-ref')).resolves.toMatchObject({ installed: true })
    expect(calls).toEqual([
      { operation: 'group.member-candidates', params: { sourceRef: 'group-ref', query: '林', limit: 10 } },
      { operation: 'group.invite-preview', params: { sourceRef: 'group-ref' } },
      { operation: 'group.members.add', params: { sourceRef: 'group-ref', candidateRefs: ['candidate-ref'] } },
      { operation: 'group.bots', params: { sourceRef: 'group-ref' } },
      { operation: 'group.bot.add', params: { sourceRef: 'group-ref', botRef: 'bot-ref' } },
    ])
  })

  it('exposes typed current-user extension inventory and Cordis publication', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'extensions.mine.list') return success({ items: [
          {
            ownedRef: 'owned-cordis', name: 'Cordis', description: '', states: ['cordis'],
            halves: { host: true, client: false },
            publish: { allowed: true, mode: 'new', route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' },
          },
          {
            ownedRef: 'owned-native', name: 'Native', description: '', states: ['persisted'],
            halves: { host: true, client: false },
            publish: { allowed: true, mode: 'new', route: 'profile-native-v3', artifactContractVersion: 3, artifactKind: 'dsh-native-package-tgz' },
          },
        ], warnings: [] })
        if (request.operation === 'extensions.mine.publish') {
          return success({ extension_id: 'ext-1', version: '1.0.0', status: 'published' })
        }
        if (request.operation === 'extensions.metadata.update') {
          return success({
            extension_id: 'ext-1', name: '新名称', description: '', visibility: 'public', updated_at: 2,
          })
        }
		if (request.operation === 'extensions.share.rotate') {
			return success({ ref: 'extshare_0123456789abcdef0123456789abcdef', url: 'https://jiwo.cc/app/share/extension/extshare_0123456789abcdef0123456789abcdef' })
		}
		if (request.operation === 'extensions.share.detail') {
			return success({
				name: '天气', description: '天气扩展', visibility: 'private', share_scope: 'link_readonly',
				latest_stable_version: '1.0.0', preview_images: [],
				rating_summary: { average: 4.5, count: 2, histogram: [0, 0, 0, 1, 1] },
			})
		}
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.myExtensions({ currentSessionId: 'session-1' })).resolves.toMatchObject({ items: [
      { publish: { route: 'dynamic-cordis-v2', artifactContractVersion: 2, artifactKind: 'dsh-bundle-tgz' } },
      { publish: { route: 'profile-native-v3', artifactContractVersion: 3, artifactKind: 'dsh-native-package-tgz' } },
    ], warnings: [] })
    await expect(sdk.publishMyExtension({
      ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
		visibility: 'private', githubRepositoryUrl: 'https://github.com/example/weather',
		clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
    })).resolves.toMatchObject({ status: 'published' })
    await expect(sdk.publishMyExtension({
      ownedRef: 'owned-native', name: '原生天气', description: '原生天气卡片', version: '1.1.0',
		visibility: 'public', clientMutationId: 'b30ce6f3-b8eb-4d2e-b9ea-cfed4e209ece',
    })).resolves.toMatchObject({ status: 'published' })
    await expect(sdk.updateExtensionMetadata('ext-1', {
      name: '新名称', description: '', visibility: 'public',
      clientMutationId: '6f85dfb8-bf84-43c8-8074-c5ac10990f40',
    })).resolves.toMatchObject({ name: '新名称', visibility: 'public' })
		await expect(sdk.rotateExtensionShare('ext-1', '07d24dc1-51ab-4e7d-9a6d-f7f50b652bf8')).resolves.toMatchObject({
			ref: 'extshare_0123456789abcdef0123456789abcdef',
		})
		await expect(sdk.extensionShareDetail('extshare_0123456789abcdef0123456789abcdef')).resolves.toMatchObject({
			name: '天气', share_scope: 'link_readonly',
		})
    expect(calls).toEqual([
      { operation: 'extensions.mine.list', params: { currentSessionId: 'session-1' } },
      { operation: 'extensions.mine.publish', params: {
        ownedRef: 'owned-ref', name: '天气', description: '天气卡片', version: '1.0.0',
			visibility: 'private', githubRepositoryUrl: 'https://github.com/example/weather',
			clientMutationId: '9f445b4f-55aa-45c1-9250-25161832d432',
      } },
      { operation: 'extensions.mine.publish', params: {
        ownedRef: 'owned-native', name: '原生天气', description: '原生天气卡片', version: '1.1.0',
			visibility: 'public', clientMutationId: 'b30ce6f3-b8eb-4d2e-b9ea-cfed4e209ece',
      } },
      { operation: 'extensions.metadata.update', params: {
        extensionId: 'ext-1', name: '新名称', description: '', visibility: 'public',
        clientMutationId: '6f85dfb8-bf84-43c8-8074-c5ac10990f40',
      } },
		{ operation: 'extensions.share.rotate', params: {
			extensionId: 'ext-1', clientMutationId: '07d24dc1-51ab-4e7d-9a6d-f7f50b652bf8',
		} },
		{ operation: 'extensions.share.detail', params: {
			shareRef: 'extshare_0123456789abcdef0123456789abcdef',
		} },
    ])
    expect(() => sdk.publishMyExtension({
      ownedRef: '', name: '天气', description: '天气卡片', version: '1.0.0',
      visibility: 'private', clientMutationId: 'bad',
    })).toThrow(/reference|引用/)
    await expect(sdk.updateExtensionMetadata('ext-1', {
      name: '新名称', description: '', visibility: 'unlisted' as never,
      clientMutationId: '6f85dfb8-bf84-43c8-8074-c5ac10990f40',
    })).rejects.toThrow(/metadata|visibility/)
  })

  it('keeps all five outgoing-call Host operations typed while credentials stay off dedicated SDK methods', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'calls.outgoing.intent.claim') return success(null satisfies ArkmeOutgoingCallIntentClaim | null)
        if (request.operation === 'calls.outgoing.prepare') return success({} as ArkmeOutgoingCallPrepareResult)
        return success(undefined)
      },
    })

    await sdk.call<ArkmeOutgoingCallIntentClaim | null>('calls.outgoing.intent.claim')
    await sdk.call<void>('calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'calling',
    })
    await sdk.call<ArkmeOutgoingCallPrepareResult>('calls.outgoing.prepare', {
      sourceRef: 'private-ref', mediaType: 'audio', callRequestId: 'call-1',
    })
    await sdk.call<void>('calls.outgoing.heartbeat', { callRequestId: 'call-1' })
    await sdk.call<void>('calls.outgoing.release', { callRequestId: 'call-1' })

    expect(calls.map(call => call.operation)).toEqual([
      'calls.outgoing.intent.claim',
      'calls.outgoing.intent.resolve',
      'calls.outgoing.prepare',
      'calls.outgoing.heartbeat',
      'calls.outgoing.release',
    ])
    expect('prepareOutgoingCall' in sdk).toBe(false)
    const safeResult: ArkmeOutgoingCallToolResult = { status: 'calling', displayName: '小林', mediaType: 'audio' }
    expect(safeResult).not.toHaveProperty('userSig')
  })

  it('packages the pinned call assets and exports the public Arkme call contract', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      files: string[]
      scripts: Record<string, string>
    }
    const rootSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

    expect(manifest.files).toContain('assets/desktop_call')
    expect(manifest.scripts['verify:call-assets']).toBe('node scripts/verify-call-assets.mjs')
    for (const name of [
      'ArkmeOutgoingCallFailureCode',
      'ArkmeOutgoingCallMediaType',
      'ArkmeOutgoingCallIntentClaim',
      'ArkmeOutgoingCallIntentResolutionInput',
      'ArkmeOutgoingCallPrepareResult',
      'ArkmeOutgoingCallToolResult',
    ]) expect(rootSource).toContain(name)
  })

  it('notifies subscribers only when auth identity or revision changes', async () => {
    vi.useFakeTimers()
    const states: ArkmeProviderState[] = [
      { contractVersion: 1, environment: 'test', authStatus: 'authenticated', userId: 1, revision: 2 },
      { contractVersion: 1, environment: 'test', authStatus: 'authenticated', userId: 1, revision: 2 },
      { contractVersion: 1, environment: 'test', authStatus: 'authenticated', userId: 1, revision: 3 },
    ]
    let index = 0
    const sdk = createArkmeSdk({
      fetchImpl: async () => success(states[Math.min(index++, states.length - 1)]),
    })
    const listener = vi.fn()
    const unsubscribe = sdk.subscribe(listener, { intervalMs: 500 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)
    expect(listener.mock.calls.map(call => call[0].revision)).toEqual([2, 3])
    unsubscribe()
  })

  it('maps Provider failures to ArkmeClientError', async () => {
    const sdk = createArkmeSdk({
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'login-required', message: '请先登录 Arkme', retryable: false },
      })),
    })
    await expect(sdk.state()).rejects.toBeInstanceOf(ArkmeClientError)
  })
})
