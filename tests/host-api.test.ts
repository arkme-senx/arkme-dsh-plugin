import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import { ARKME_RUNTIME_INSTANCE_ID } from '../src/runtime-instance.js'

function fakeService() {
  return {
    resolveLinkMetadata: vi.fn(async (
      url: string,
      _options?: unknown,
    ): Promise<{ url: string; title: string } | null> => ({ url, title: '即我 Jotmo' })),
    prepareOutgoingCall: vi.fn(async (input: unknown) => input),
    listCallHistory: vi.fn(async (input: unknown) => input),
    callDetail: vi.fn(async (callRef: string) => ({ callRef })),
    retryCallSummary: vi.fn(async (callRef: string) => ({ callRef, status: 'submitted' })),
    claimOutgoingCallIntent: vi.fn(async () => null),
    resolveOutgoingCallIntent: vi.fn(async () => undefined),
    heartbeatOutgoingCall: vi.fn(async () => ({ expiresAtMillis: 1 })),
    releaseOutgoingCall: vi.fn(async () => undefined),
    searchRemote: vi.fn(async (input: unknown) => input),
    searchScene: vi.fn(async (input: unknown) => input),
    searchImages: vi.fn(async (input: unknown) => input),
    searchRecordings: vi.fn(async (input: unknown) => input),
    calendarBuckets: vi.fn(async (input: unknown) => input),
    calendarRecords: vi.fn(async (input: unknown) => input),
    searchContact: vi.fn(async (identifier: string) => ({ identifier })),
    addContact: vi.fn(async (_contactRef: string, options: unknown) => options),
    createGroup: vi.fn(async (title: string, clientMutationId: string) => ({ title, clientMutationId })),
    createBotSummary: vi.fn(async (input: unknown) => input),
    aiVideoList: vi.fn(async (input: unknown) => input),
    queryFileAssets: vi.fn(async (input: unknown) => input),
    arkoRunStatus: vi.fn(async () => ({ status: 'running' })),
    arkoCancel: vi.fn(async () => ({ status: 'cancel_requested' })),
    interwovenMoments: vi.fn(async (sourceRef: string) => ({ sourceRef })),
    interwovenMomentDetail: vi.fn(async (sourceRef: string, momentRef: string) => ({ sourceRef, momentRef })),
    relatedQuickNotesFromMessage: vi.fn(async (sourceRef: string, messageActionRef: string) => ({ sourceRef, messageActionRef })),
    relatedQuickNotesFromMoment: vi.fn(async (sourceRef: string, momentRef: string) => ({ sourceRef, momentRef })),
    relatedQuickNoteDetail: vi.fn(async (sourceRef: string, relatedRef: string) => ({ sourceRef, relatedRef })),
    listSourceMembers: vi.fn(async (sourceRef: string, options: unknown) => ({ sourceRef, options })),
    sourceMemberRecords: vi.fn(async (sourceRef: string, memberRef: string, mode: string, options: unknown) => ({ sourceRef, memberRef, mode, options })),
    messageReadReceiptSummaries: vi.fn(async (sourceRef: string, items: unknown, options: unknown) => ({ sourceRef, items, options })),
    messageReadReceiptDetail: vi.fn(async (sourceRef: string, itemUid: string, sequence: number, options: unknown) => ({ sourceRef, itemUid, sequence, options })),
    officialAuthorProfile: vi.fn(async () => ({ userId: 11, displayName: '阿森', avatarRef: 'author-avatar-ref' })),
    openOfficialAuthorPrivateChat: vi.fn(async () => ({ source: { sourceRef: 'official-author-source' } })),
    openPrivateChatFromContact: vi.fn(async (contactRef: string) => ({ source: { sourceRef: `source:${contactRef}` } })),
    openPrivateChatFromMember: vi.fn(async (sourceRef: string, memberRef: string) => ({ sourceRef, memberRef })),
    reportMessage: vi.fn(async (messageRef: string, reportType: number, options: unknown) => ({ messageRef, reportType, options })),
    copySourceMessageLink: vi.fn(async (sourceRef: string, actionRefs: unknown, options: unknown) => ({ sourceRef, actionRefs, options })),
    resolveMessageCopyLink: vi.fn(async (sid: string, options: unknown) => ({ sid, options })),
    extendMessageCopyLink: vi.fn(async (sid: string, itemIndex: number, textContent: string, recordUid: string, options: unknown) => ({ sid, itemIndex, textContent, recordUid, options })),
    sharedRecordingDetail: vi.fn(async (detailRef: string, options: unknown) => ({ detailRef, options })),
    forwardSourceMessages: vi.fn(async (sourceRef: string, actionRefs: unknown, options: unknown) => ({ sourceRef, actionRefs, options })),
    sendSourceText: vi.fn(async (_sourceRef: string, _text: string, options: unknown) => options),
    sendSourceRich: vi.fn(async () => undefined),
    favoriteStickers: vi.fn(async () => ({ items: [], itemCount: 0, updatedAtMillis: 0 })),
    addFavoriteSticker: vi.fn(async (item: unknown) => item),
    manageFavoriteSticker: vi.fn(async (fileAssetUid: string, action: string) => ({ fileAssetUid, action })),
    sendFavoriteSticker: vi.fn(async (_sourceRef: string, _fileAssetUid: string, options: unknown) => options),
    longArticleDetail: vi.fn(async (sourceRef: string, itemUid: string) => ({ sourceRef, itemUid })),
    updateLongArticle: vi.fn(async (_sourceRef: string, _itemUid: string, input: unknown) => input),
    getLongArticleDraft: vi.fn(async () => undefined),
    putLongArticleDraft: vi.fn(async () => undefined),
    removeLongArticleDraft: vi.fn(async () => undefined),
    listGroupMemberCandidates: vi.fn(async () => ({ items: [] })),
    addGroupMembers: vi.fn(async () => ({ items: [] })),
    groupInvitePreview: vi.fn(async () => ({ inviteLink: 'https://example.test/invite' })),
    listGroupBots: vi.fn(async () => ({ items: [] })),
    addGroupBot: vi.fn(async () => ({ installed: true })),
    generateGroupAiPolishRuleForSource: vi.fn(async () => ({ confirmationRef: 'confirm-1' })),
    prepareEnableGroupAiPolishRuleForSource: vi.fn(async () => ({ confirmationRef: 'confirm-2' })),
    listMyWorldFeed: vi.fn(async (input: unknown) => input),
    listUserWorldFeed: vi.fn(async (_userId: number, input: unknown) => input),
    publishWorldText: vi.fn(async (input: unknown) => input),
    publishWorldFileAssets: vi.fn(async (input: unknown) => input),
    worldVoiceprintSocialContext: vi.fn(async (recordRef: string, options: unknown) => ({ recordRef, options })),
    inviteWorldVoiceprint: vi.fn(async (recordRef: string) => ({ sent: true, peerDisplayName: '小林', recordRef })),
    billingQuota: vi.fn(async () => ({
      availableNanoCny: '1200', totalNanoCny: '1500', reservedNanoCny: '300', currency: 'CNY',
    })),
    billingProducts: vi.fn(async () => ({ items: [] })),
    createBillingOrder: vi.fn(async (input: unknown) => input),
    billingOrderStatus: vi.fn(async (orderId: string) => ({ orderId, status: 'pending' })),
    checkArkmeIdAvailability: vi.fn(async (arkmeId: string) => ({ available: true, reason: '', arkmeId })),
    setArkmeIdOnce: vi.fn(async (arkmeId: string) => ({ arkmeId, changed: true, canUpdate: false, revision: 2 })),
  }
}

describe('provider instance Host API dispatch', () => {
  it('returns the same process identity used by the realtime transport', async () => {
    await expect(dispatchArkmeHostOperation({} as never, 'provider.instance', {}))
      .resolves.toEqual({ instanceId: ARKME_RUNTIME_INSTANCE_ID })
    await expect(dispatchArkmeHostOperation({} as never, 'provider.instance', {}))
      .resolves.toEqual({ instanceId: ARKME_RUNTIME_INSTANCE_ID })
  })
})

describe('account settings Host API dispatch', () => {
  it('dispatches Arkme ID checks and writes without browser-owned account fields', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'user.arkme-id.check', {
      arkmeId: '  Lucis_01  ', userId: 999,
    })).resolves.toMatchObject({ arkmeId: '  Lucis_01  ' })
    await expect(dispatchArkmeHostOperation(service as never, 'user.arkme-id.set', {
      arkmeId: 'Lucis_01', accessToken: 'secret',
    })).resolves.toMatchObject({ arkmeId: 'Lucis_01', changed: true })

    expect(service.checkArkmeIdAvailability).toHaveBeenCalledWith('  Lucis_01  ')
    expect(service.setArkmeIdOnce).toHaveBeenCalledWith('Lucis_01')
  })
})

describe('billing Host API dispatch', () => {
  it('dispatches quota and product reads without browser account fields', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'billing.quota', { userId: 999 })
    await dispatchArkmeHostOperation(service as never, 'billing.products', { accessToken: 'secret' })

    expect(service.billingQuota).toHaveBeenCalledWith()
    expect(service.billingProducts).toHaveBeenCalledWith()
  })

  it('passes only the normalized order creation identity to the service', async () => {
    const service = fakeService()
    const clientRequestId = '8e37aebc-e2ba-4db2-b589-da729867410c'

    await dispatchArkmeHostOperation(service as never, 'billing.order.create', {
      productId: 'product-1', paymentMethod: 'wechat_native', clientRequestId,
      amountMinor: 1, userId: 999,
    })

    expect(service.createBillingOrder).toHaveBeenCalledWith({
      productId: 'product-1', paymentMethod: 'wechat_native', clientRequestId,
    })
  })

  it.each([
    [{ productId: '', paymentMethod: 'wechat_native', clientRequestId: '8e37aebc-e2ba-4db2-b589-da729867410c' }, 'billing-product-id-invalid'],
    [{ productId: 'product-1', paymentMethod: 'card', clientRequestId: '8e37aebc-e2ba-4db2-b589-da729867410c' }, 'billing-payment-method-invalid'],
    [{ productId: 'product-1', paymentMethod: 'alipay_pc_web', clientRequestId: '' }, 'billing-client-request-id-invalid'],
    [{ productId: 'product-1', paymentMethod: 'alipay_pc_web', clientRequestId: 'request-1' }, 'billing-client-request-id-invalid'],
  ])('rejects invalid order creation parameters', async (params, code) => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'billing.order.create', params))
      .rejects.toMatchObject({ code })
    expect(service.createBillingOrder).not.toHaveBeenCalled()
  })

  it('requires an order UUID and does not forward unknown status fields', async () => {
    const service = fakeService()
    const orderId = '755a40f2-b5a5-420f-a7c5-1e4543cf016c'

    await expect(dispatchArkmeHostOperation(service as never, 'billing.order.status', { orderId: '' }))
      .rejects.toMatchObject({ code: 'billing-order-id-invalid' })
    await expect(dispatchArkmeHostOperation(service as never, 'billing.order.status', { orderId: 'order-1' }))
      .rejects.toMatchObject({ code: 'billing-order-id-invalid' })
    await dispatchArkmeHostOperation(service as never, 'billing.order.status', { orderId, accessToken: 'secret' })
    expect(service.billingOrderStatus).toHaveBeenCalledWith(orderId)
  })
})

describe('favorite sticker Host API dispatch', () => {
  it('forwards one bounded favorite sticker addition', async () => {
    const service = fakeService()
    const item = {
      fileAssetUid: 'asset-12345678', fileName: 'wave.gif', mimeType: 'image/gif', size: 128, fileKind: 1,
      isAnimated: true,
    }

    await dispatchArkmeHostOperation(service as never, 'favorite-stickers.add', { item, signedUrl: 'must-not-forward' })

    expect(service.addFavoriteSticker).toHaveBeenCalledWith(item)
  })

  it('forwards only the bounded sticker id and management action', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'favorite-stickers.manage', {
      fileAssetUid: 'asset-12345678', action: 'move-to-front', accountId: 999, signedUrl: 'must-not-forward',
    })

    expect(service.manageFavoriteSticker).toHaveBeenCalledWith('asset-12345678', 'move-to-front')
    await expect(dispatchArkmeHostOperation(service as never, 'favorite-stickers.manage', {
      fileAssetUid: 'asset-12345678', action: 'replace',
    })).rejects.toMatchObject({ code: 'favorite-sticker-manage-invalid' })
  })
})

describe('link metadata Host API dispatch', () => {
  it('dispatches link title resolution through its dedicated infrastructure owner', async () => {
    const service = fakeService()
    const request = new AbortController()

    await expect(dispatchArkmeHostOperation(service as never, 'link.metadata', {
      url: 'https://jotmo.ai/path',
    }, undefined, undefined, undefined, undefined, request.signal)).resolves.toEqual({
      url: 'https://jotmo.ai/path', title: '即我 Jotmo',
    })
    expect(service.resolveLinkMetadata).toHaveBeenCalledWith('https://jotmo.ai/path', { signal: request.signal })
  })

  it('owns the public SDK non-null fallback without forwarding that policy into infrastructure', async () => {
    const service = fakeService()
    service.resolveLinkMetadata.mockResolvedValueOnce(null)
    const request = new AbortController()

    await expect(dispatchArkmeHostOperation(service as never, 'source.link-metadata.resolve', {
      url: ' https://example.com/a ', cookie: 'must-not-forward',
    }, undefined, undefined, undefined, undefined, request.signal)).resolves.toEqual({
      url: 'https://example.com/a', title: '分享链接', siteName: 'example.com',
    })
    expect(service.resolveLinkMetadata).toHaveBeenCalledWith(' https://example.com/a ', {
      signal: request.signal,
    })

    service.resolveLinkMetadata.mockResolvedValueOnce(null)
    await expect(dispatchArkmeHostOperation(service as never, 'source.link-metadata.resolve', {
      url: 'https://github.com/arkme-senx/arkme-dsh-plugin/pull/145',
    })).resolves.toEqual({
      url: 'https://github.com/arkme-senx/arkme-dsh-plugin/pull/145',
      title: 'Pull Request #145 · arkme-senx/arkme-dsh-plugin',
      siteName: 'github.com',
    })
  })

  it('requires a same-origin Browser request before starting link metadata work', async () => {
    const service = fakeService()
    const server = createServer(createArkmeHostApi(service as never, {
      expectedPort: 3080,
      allowNonLoopback: false,
    }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    try {
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'link.metadata', params: { url: 'https://jotmo.ai/' } }),
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'origin-required' } })
      expect(service.resolveLinkMetadata).not.toHaveBeenCalled()

      const accepted = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:3080', 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'link.metadata', params: { url: 'https://jotmo.ai/' } }),
      })
      expect(accepted.status).toBe(200)
      expect(service.resolveLinkMetadata).toHaveBeenCalledWith('https://jotmo.ai/', {
        signal: expect.any(AbortSignal),
      })
    } finally {
      server.close()
      await once(server, 'close')
    }
  })
})

describe('World publish Host API dispatch', () => {
  it('aborts an in-flight voiceprint generation when its Browser request disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined
    const generationStarted = Promise.withResolvers<void>()
    const generationAborted = Promise.withResolvers<void>()
    const service = {
      generateWorldVoiceprintPlayback: vi.fn(async (input: { signal?: AbortSignal }) => {
        upstreamSignal = input.signal
        generationStarted.resolve()
        await new Promise<void>(resolve => {
          if (input.signal?.aborted === true) resolve()
          else input.signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        generationAborted.resolve()
        throw new Error('cancelled')
      }),
    }
    const server = createServer(createArkmeHostApi(service as never, {
      expectedPort: 0,
      allowNonLoopback: false,
    }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    const controller = new AbortController()
    try {
      const request = fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'world.voiceprint.playback.generate',
          params: { recordRef: 'record-ref', chunkIndex: 0 },
        }),
        signal: controller.signal,
      })
      await generationStarted.promise
      controller.abort()
      await expect(request).rejects.toMatchObject({ name: 'AbortError' })
      await generationAborted.promise
      expect(upstreamSignal?.aborted).toBe(true)
    } finally {
      server.close()
      await once(server, 'close')
    }
  })

  it('keeps text publishing separate and drops Browser-owned fields', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'world.publish-text', {
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: ' 世界正文 ',
      recordUid: 'must-not-forward',
      accessToken: 'must-not-forward',
      fileAssets: [{ fileAssetUid: 'must-not-forward' }],
    })

    expect(service.publishWorldText).toHaveBeenCalledWith({
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: ' 世界正文 ',
    })
    expect(service.publishWorldFileAssets).not.toHaveBeenCalled()
  })

  it('accepts only bounded image upload results for file-asset publishing', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'world.publish-file-assets', {
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: '图片正文',
      fileAssets: [{
        fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png',
        size: 128, fileKind: 1, sortOrder: 99, signedUrl: 'must-not-forward',
      }],
    })

    expect(service.publishWorldFileAssets).toHaveBeenCalledWith({
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: '图片正文',
      fileAssets: [{
        fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png',
        size: 128, fileKind: 1,
      }],
    })
  })

  it('matches the mobile limit of 27 images when publishing World posts', async () => {
    const service = fakeService()
    const image = (index: number) => ({
      fileAssetUid: `asset-${String(index).padStart(8, '0')}`,
      fileName: `${String(index)}.png`,
      mimeType: 'image/png',
      size: 128,
      fileKind: 1,
    })

    await dispatchArkmeHostOperation(service as never, 'world.publish-file-assets', {
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: '二十七张图片',
      fileAssets: Array.from({ length: 27 }, (_value, index) => image(index + 1)),
    })
    expect(service.publishWorldFileAssets).toHaveBeenCalledOnce()

    await expect(dispatchArkmeHostOperation(service as never, 'world.publish-file-assets', {
      clientMutationId: '7e0f21bf-5f04-477c-b221-f8285d4a88b2',
      textContent: '二十八张图片',
      fileAssets: Array.from({ length: 28 }, (_value, index) => image(index + 1)),
    })).rejects.toMatchObject({ code: 'world-publish-assets-invalid', message: '请选择 1 至 27 张图片' })
  })

  it('rejects non-image assets before entering the World domain', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'world.publish-file-assets', {
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: '文件正文',
      fileAssets: [{
        fileAssetUid: 'asset-12345678', fileName: 'a.pdf', mimeType: 'application/pdf',
        size: 128, fileKind: 4,
      }],
    })).rejects.toMatchObject({ code: 'world-publish-assets-invalid' })
    expect(service.publishWorldFileAssets).not.toHaveBeenCalled()
  })
})

describe('group member Host API dispatch', () => {
  it('forwards only bounded candidate discovery and add fields', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'group.member-candidates', {
      sourceRef: 'group-ref', query: '林', limit: 12.8, userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'group.member-candidates', {
      sourceRef: 'group-ref', groupSourceRefs: ['peer-group-ref'], userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'group.members.add', {
      sourceRef: 'group-ref', candidateRefs: ['candidate-1'], userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'group.invite-preview', {
      sourceRef: 'group-ref', userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'group.bots', { sourceRef: 'group-ref', userId: 999 })
    await dispatchArkmeHostOperation(service as never, 'group.bot.add', { sourceRef: 'group-ref', botRef: 'bot-ref', userId: 999 })
    expect(service.listGroupMemberCandidates).toHaveBeenCalledWith('group-ref', { query: '林', limit: 12.8 })
    expect(service.listGroupMemberCandidates).toHaveBeenCalledWith('group-ref', { limit: 20, groupSourceRefs: ['peer-group-ref'] })
    expect(service.addGroupMembers).toHaveBeenCalledWith('group-ref', ['candidate-1'])
    expect(service.groupInvitePreview).toHaveBeenCalledWith('group-ref')
    expect(service.listGroupBots).toHaveBeenCalledWith('group-ref')
    expect(service.addGroupBot).toHaveBeenCalledWith('group-ref', 'bot-ref')
  })
})

describe('group AI polish Host API dispatch', () => {
  it('forwards only source-bound rule data and a bounded browser-safe conversation', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.ai-polish.generate-rule', {
      sourceRef: 'group-ref', requirement: '更简洁', userId: 999,
      targetRuleRef: 'rule-ref',
      threadMessages: [
        { id: 'r0', role: 'ai', text: '说明要求' },
        { id: 'bad', role: 'system', text: '不能进入 Host owner' },
        { id: 'r1', role: 'user', text: '更简洁', ruleRef: 'internal-rule-ref' },
      ],
    })
    await dispatchArkmeHostOperation(service as never, 'source.ai-polish.prepare-enable', {
      sourceRef: 'group-ref', ruleRef: 'rule-ref', userId: 999,
    })
    expect(service.generateGroupAiPolishRuleForSource).toHaveBeenCalledWith('group-ref', '更简洁', {
      threadMessages: [
        { id: 'r0', role: 'ai', text: '说明要求' },
        { id: 'r1', role: 'user', text: '更简洁', ruleRef: 'internal-rule-ref' },
      ],
      targetRuleRef: 'rule-ref',
    })
    expect(service.prepareEnableGroupAiPolishRuleForSource).toHaveBeenCalledWith('group-ref', 'rule-ref')
  })
})

describe('conversation member Host API dispatch', () => {
  it('forwards only opaque member references and bounded paging fields', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.members', {
      sourceRef: 'source-ref', activeOnly: false, userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'source.member-records', {
      sourceRef: 'source-ref', memberRef: 'member-ref', mode: 'mentioned', limit: 19, beforeSequence: 44,
      memberUserId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'chat.member.private.open', {
      sourceRef: 'source-ref', memberRef: 'member-ref', peerUserId: 999,
    })
    expect(service.listSourceMembers).toHaveBeenCalledWith('source-ref', { activeOnly: false })
    expect(service.sourceMemberRecords).toHaveBeenCalledWith('source-ref', 'member-ref', 'mentioned', {
      limit: 19,
      beforeSequence: 44,
    })
    expect(service.openPrivateChatFromMember).toHaveBeenCalledWith('source-ref', 'member-ref')
  })

  it('opens the official author chat through its Host-owned route', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'chat.official-author.private.open', {
      peerUserId: 11,
      displayName: '伪造作者',
      sourceRef: 'leak',
    })
    expect(service.openOfficialAuthorPrivateChat).toHaveBeenCalledWith()
  })

  it('reads the official author profile through its Host-owned route', async () => {
    const service = fakeService()
    await expect(dispatchArkmeHostOperation(service as never, 'chat.official-author.profile', {
      peerUserId: 999,
      displayName: '伪造作者',
    })).resolves.toEqual({ userId: 11, displayName: '阿森', avatarRef: 'author-avatar-ref' })
    expect(service.officialAuthorProfile).toHaveBeenCalledWith()
  })

  it('rejects an unknown member-record mode instead of silently widening it', async () => {
    const service = fakeService()
    await expect(dispatchArkmeHostOperation(service as never, 'source.member-records', {
      sourceRef: 'source-ref', memberRef: 'member-ref', mode: 'all',
    })).rejects.toMatchObject({ code: 'chat-member-record-mode-invalid' })
    expect(service.sourceMemberRecords).not.toHaveBeenCalled()
  })

  it('keeps structured human mention fields while dropping browser-owned ids', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.send-text', {
      sourceRef: 'source-ref', textContent: '@小林 请看', recordUid: 'record-ref', relationUid: 'relation-ref',
      humanMentions: [{ mentionRef: 'mention-ref', startIndex: 0, length: 3, userId: 999 }],
    })
    expect(service.sendSourceText).toHaveBeenCalledWith('source-ref', '@小林 请看', {
      recordUid: 'record-ref',
      relationUid: 'relation-ref',
      humanMentions: [{ mentionRef: 'mention-ref', startIndex: 0, length: 3 }],
    })
  })

  it('rejects member action refs in the mention-scoped send contract', async () => {
    const service = fakeService()
    await expect(dispatchArkmeHostOperation(service as never, 'source.send-text', {
      sourceRef: 'source-ref', textContent: '@小林 请看', recordUid: 'record-ref', relationUid: 'relation-ref',
      humanMentions: [{ memberRef: 'member-ref', startIndex: 0, length: 3, userId: 999 }],
    })).rejects.toMatchObject({ code: 'human-mention-invalid' })
    expect(service.sendSourceText).not.toHaveBeenCalled()
  })

  it('rejects ambiguous human mention refs instead of choosing one implicitly', async () => {
    const service = fakeService()
    await expect(dispatchArkmeHostOperation(service as never, 'source.send-text', {
      sourceRef: 'source-ref', textContent: '@小林 请看', recordUid: 'record-ref', relationUid: 'relation-ref',
      humanMentions: [{ mentionRef: 'mention-ref', memberRef: 'member-ref', startIndex: 0, length: 3 }],
    })).rejects.toMatchObject({ code: 'human-mention-invalid' })
    expect(service.sendSourceText).not.toHaveBeenCalled()
  })

  it('keeps @所有人 human mention intent without requiring a member ref', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.send-text', {
      sourceRef: 'source-ref', textContent: '@所有人 请看', recordUid: 'record-ref', relationUid: 'relation-ref',
      humanMentions: [{ all: true, startIndex: 0, length: 4 }],
    })
    expect(service.sendSourceText).toHaveBeenCalledWith('source-ref', '@所有人 请看', {
      recordUid: 'record-ref',
      relationUid: 'relation-ref',
      humanMentions: [{ all: true, startIndex: 0, length: 4 }],
    })
  })

  it('rejects a member-scoped capability on an @所有人 range', async () => {
    const service = fakeService()
    await expect(dispatchArkmeHostOperation(service as never, 'source.send-text', {
      sourceRef: 'source-ref', textContent: '@所有人 请看', recordUid: 'record-ref', relationUid: 'relation-ref',
      humanMentions: [{ all: true, mentionRef: 'mention-ref', startIndex: 0, length: 4 }],
    })).rejects.toMatchObject({ code: 'human-mention-invalid' })
    expect(service.sendSourceText).not.toHaveBeenCalled()
  })

  it('keeps structured Bot mention ranges without exposing browser-owned fields', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.send-text', {
      sourceRef: 'source-ref', textContent: '@总结助手 请看', recordUid: 'record-ref', relationUid: 'relation-ref',
      botMentions: [{ botRef: 'bot-ref', startIndex: 0, length: 5, botId: 'browser-owned' }],
    })
    expect(service.sendSourceText).toHaveBeenCalledWith('source-ref', '@总结助手 请看', {
      recordUid: 'record-ref',
      relationUid: 'relation-ref',
      botMentions: [{ botRef: 'bot-ref', startIndex: 0, length: 5 }],
    })
  })
})

describe('message read receipt Host API dispatch', () => {
  it('forwards only opaque message identities and the request lifecycle signal', async () => {
    const service = fakeService()
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation(service as never, 'source.read-receipts.summary-list', {
      sourceRef: 'source-ref',
      items: [{ itemUid: 'record-1', sequence: 8, readerUserId: 999 }],
      chatSessionUid: 'must-not-forward',
    }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service as never, 'source.read-receipts.detail', {
      sourceRef: 'source-ref', itemUid: 'record-1', sequence: 8, readerUserId: 999,
    }, undefined, undefined, undefined, undefined, signal)

    expect(service.messageReadReceiptSummaries).toHaveBeenCalledWith(
      'source-ref', [{ itemUid: 'record-1', sequence: 8 }], { signal },
    )
    expect(service.messageReadReceiptDetail).toHaveBeenCalledWith(
      'source-ref', 'record-1', 8, { signal },
    )
  })

  it('rejects a non-array summary input before entering the Host owner', async () => {
    const service = fakeService()
    await expect(dispatchArkmeHostOperation(service as never, 'source.read-receipts.summary-list', {
      sourceRef: 'source-ref', items: { itemUid: 'record-1', sequence: 8 },
    })).rejects.toMatchObject({ code: 'message-read-receipt-items-invalid' })
    expect(service.messageReadReceiptSummaries).not.toHaveBeenCalled()
  })
})

describe('message action Host API dispatch', () => {
  it('forwards only the opaque shared-recording detail reference', async () => {
    const service = fakeService()
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation(service as never, 'source.shared-recording-detail', {
      detailRef: ' shared-detail-ref ',
      chatSessionUid: 'must-not-forward',
      recordOwnerUserId: 999,
      recordUid: 'must-not-forward',
    }, undefined, undefined, undefined, undefined, signal)
    expect(service.sharedRecordingDetail).toHaveBeenCalledWith(' shared-detail-ref ', { signal })
  })

  it('forwards only opaque message action references and bounded send identifiers', async () => {
    const service = fakeService()
    const requestUid = '019d8590-ebb4-7232-90f2-000000000001'
    await dispatchArkmeHostOperation(service as never, 'source.message-report', {
      messageRef: ' arkme-message-v1.payload.signature ', reportType: 4, reason: ' 补充说明 ', requestUid,
      chatSessionUid: 'must-not-forward', relationUid: 'must-not-forward', reporterUserId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'source.message-copy-link', {
      sourceRef: 'source-ref', actionRefs: ['action-1', '', 'action-2'], relationUid: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'source.message-copy-link.resolve', {
      sid: 'U2HQgn1RhPJZaFmx', sourceRef: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'source.message-copy-link.extend', {
      sid: 'U2HQgn1RhPJZaFmx', itemIndex: 1, textContent: ' 延展 ', recordUid: 'record-1', relationUid: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'source.forward-messages', {
      sourceRef: 'source-ref', actionRefs: ['action-1'], recordUid: 'record-1', relationUid: 'rel-1',
      targetSourceRef: 'target-source-ref', commentText: ' 附言 ',
      textContent: 'must-not-forward',
    })

    expect(service.reportMessage).toHaveBeenCalledWith('arkme-message-v1.payload.signature', 4, {
      reason: '补充说明', requestUid,
    })
    expect(service.copySourceMessageLink).toHaveBeenCalledWith('source-ref', ['action-1', 'action-2'], expect.any(Object))
    expect(service.resolveMessageCopyLink).toHaveBeenCalledWith('U2HQgn1RhPJZaFmx', expect.any(Object))
    expect(service.extendMessageCopyLink).toHaveBeenCalledWith('U2HQgn1RhPJZaFmx', 1, ' 延展 ', 'record-1', expect.any(Object))
    expect(service.forwardSourceMessages).toHaveBeenCalledWith('source-ref', ['action-1'], {
      recordUid: 'record-1',
      relationUid: 'rel-1',
      targetSourceRef: 'target-source-ref',
      commentText: ' 附言 ',
    })
    await expect(dispatchArkmeHostOperation(service as never, 'source.message-report', {
      messageRef: 'arkme-message-v1.payload.signature', reportType: 4, reason: '', requestUid,
    })).rejects.toMatchObject({ code: 'message-report-invalid' })
  })
})

describe('related quick note Host API dispatch', () => {
  it('forwards only viewer-safe opaque references and the request signal', async () => {
    const service = fakeService()
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation(service as never, 'source.related-quick-notes.from-message', {
      sourceRef: ' source-ref ', messageActionRef: ' action-ref ',
      recordUid: 'must-not-forward', recordOwnerUserId: 999, chatSessionUid: 'must-not-forward',
    }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service as never, 'source.related-quick-notes.from-moment', {
      sourceRef: ' source-ref ', momentRef: ' moment-ref ', recordUid: 'must-not-forward',
    }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service as never, 'source.related-quick-note.detail', {
      sourceRef: ' source-ref ', relatedRef: ' related-ref ', ownerUserId: 999,
    }, undefined, undefined, undefined, undefined, signal)

    expect(service.relatedQuickNotesFromMessage).toHaveBeenCalledWith('source-ref', 'action-ref', signal)
    expect(service.relatedQuickNotesFromMoment).toHaveBeenCalledWith('source-ref', 'moment-ref', signal)
    expect(service.relatedQuickNoteDetail).toHaveBeenCalledWith('source-ref', 'related-ref', signal)
  })

  it('accepts a long opaque message action reference within the signed envelope limit', async () => {
    const service = fakeService()
    const messageActionRef = `arkme-message-action-v1.${'a'.repeat(5_000)}.signature`

    await dispatchArkmeHostOperation(service as never, 'source.related-quick-notes.from-message', {
      sourceRef: 'source-ref', messageActionRef,
    })

    expect(service.relatedQuickNotesFromMessage).toHaveBeenCalledWith(
      'source-ref', messageActionRef, undefined,
    )
  })

  it('accepts a maximum-configured CJK action envelope without widening unrelated Host API requests', async () => {
    const service = fakeService()
    const encoded = Buffer.from(JSON.stringify({ textContent: '快'.repeat(100_000) })).toString('base64url')
    const messageActionRef = `arkme-message-action-v1.${encoded}.signature`
    const server = createServer(createArkmeHostApi(service as never, {
      expectedPort: 0,
      allowNonLoopback: false,
    }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    try {
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'source.related-quick-notes.from-message',
          params: { sourceRef: 'source-ref', messageActionRef },
        }),
      })

      expect(response.status).toBe(200)
      expect(service.relatedQuickNotesFromMessage).toHaveBeenCalledWith(
        'source-ref', messageActionRef, expect.any(AbortSignal),
      )

      const unrelated = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'billing.quota', params: { padding: 'a'.repeat(130 * 1024) } }),
      })
      expect(unrelated.status).toBe(413)
      expect(service.billingQuota).not.toHaveBeenCalled()
    } finally {
      server.close()
      await once(server, 'close')
    }
  })
})

describe('outgoing call Host API dispatch', () => {
  it('dispatches contact search/add without forwarding browser-owned account fields', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'contacts.search', { identifier: 'lin-lin', userId: 999 })
    await dispatchArkmeHostOperation(service as never, 'contacts.add', {
      contactRef: 'contact-ref', remark: '同事', requestUid: 'request-uid', targetUserId: 999,
    })
    expect(service.searchContact).toHaveBeenCalledWith('lin-lin')
    expect(service.addContact).toHaveBeenCalledWith('contact-ref', { remark: '同事', requestUid: 'request-uid' })
  })

  it('opens a private chat from contact search without forwarding browser-owned account fields', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'chat.private.open-from-contact', {
      contactRef: 'contact-ref', peerUserId: 999, displayName: '伪造名称', requestUid: 'must-not-forward',
    })
    expect(service.openPrivateChatFromContact).toHaveBeenCalledWith('contact-ref')
    expect(service.addContact).not.toHaveBeenCalled()
  })

  it('dispatches group and Bot quick-add through strict domain adapters', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'group.create', {
      title: '项目群', clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'bots.create', {
      name: '总结助手', provider: 'openclaw', description: '总结群聊',
      directChatOwner: 'jotmo-chat',
      avatar: 'file_asset://avatar-asset-1', requestUid: '11111111-1111-4111-8111-111111111111',
      token: 'must-not-forward',
    })
    expect(service.createGroup).toHaveBeenCalledWith('项目群', 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b')
    expect(service.createBotSummary).toHaveBeenCalledWith({
      name: '总结助手', provider: 'openclaw', description: '总结群聊', avatar: 'file_asset://avatar-asset-1',
      directChatOwner: 'jotmo-chat',
      requestUid: '11111111-1111-4111-8111-111111111111',
    })

    await expect(dispatchArkmeHostOperation(service as never, 'bots.create', {
      name: '错误 Bot', provider: 'arbitrary',
    })).rejects.toMatchObject({ code: 'bot-provider-unsupported' })

    await expect(dispatchArkmeHostOperation(service as never, 'bots.create', {
      name: '错误头像 Bot', provider: 'openclaw', avatar: 'https://untrusted.example/avatar.png',
    })).rejects.toMatchObject({ code: 'bot-avatar-invalid' })

    await expect(dispatchArkmeHostOperation(service as never, 'bots.create', {
      name: '错误 owner Bot', provider: 'openclaw', directChatOwner: 'jotmo-subject',
    })).rejects.toMatchObject({ code: 'bot-direct-chat-owner-invalid' })
  })

  it('rejects an unknown outgoing media type before calling the service', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.prepare', {
      sourceRef: 'source-ref', mediaType: 'screen', callRequestId: 'request-1',
    })).rejects.toMatchObject({ code: 'call-media-type-invalid' })
    expect(service.prepareOutgoingCall).not.toHaveBeenCalled()
  })

  it('passes only the strict prepare fields to the service', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.prepare', {
      sourceRef: 'source-ref', mediaType: 'video', callRequestId: 'request-1', userId: 999,
    })

    expect(service.prepareOutgoingCall).toHaveBeenCalledWith({
      sourceRef: 'source-ref', mediaType: 'video', callRequestId: 'request-1',
    })
  })

  it('requires non-empty one-time intent credentials', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: '', claimToken: '', status: 'calling',
    })).rejects.toMatchObject({ code: 'call-intent-invalid' })
    expect(service.resolveOutgoingCallIntent).not.toHaveBeenCalled()
  })

  it('accepts calling completion without forwarding caller-supplied failure text', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'calling',
      code: 'call-engine-failed', message: 'secret details', userId: 999,
    })

    expect(service.resolveOutgoingCallIntent).toHaveBeenCalledWith({
      intentId: 'intent-1', claimToken: 'claim-1', outcome: { status: 'calling' },
    })
  })

  it('accepts only known bounded failure details', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'failed',
      code: 'arbitrary-secret-code', message: '失败',
    })).rejects.toMatchObject({ code: 'call-failure-invalid' })

    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.intent.resolve', {
      intentId: 'intent-1', claimToken: 'claim-1', status: 'failed',
      code: 'call-permission-denied', message: '麦克风权限被拒绝',
    })
    expect(service.resolveOutgoingCallIntent).toHaveBeenCalledWith({
      intentId: 'intent-1',
      claimToken: 'claim-1',
      outcome: { status: 'failed', code: 'call-permission-denied', message: '麦克风权限被拒绝' },
    })
  })

  it('validates heartbeat and release request IDs', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'calls.outgoing.heartbeat', {
      callRequestId: '',
    })).rejects.toMatchObject({ code: 'call-request-invalid' })
    await dispatchArkmeHostOperation(service as never, 'calls.outgoing.release', {
      callRequestId: 'request-1', userId: 999,
    })
    expect(service.releaseOutgoingCall).toHaveBeenCalledWith('request-1')
  })

  it('dispatches call history operations through opaque refs only', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'calls.history.list', {
      limit: 12,
      cursor: ' next ',
      includeRecentContacts: false,
      roomId: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'calls.history.detail', {
      callRef: 'call-ref-1',
      roomId: 'must-not-forward',
      accessToken: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'calls.history.summary.retry', {
      callRef: 'call-ref-1',
      roomId: 'must-not-forward',
    })

    expect(service.listCallHistory).toHaveBeenCalledWith({
      limit: 12,
      cursor: 'next',
      includeRecentContacts: false,
    })
    expect(service.callDetail).toHaveBeenCalledWith('call-ref-1')
    expect(service.retryCallSummary).toHaveBeenCalledWith('call-ref-1')
  })

  it('dispatches strict UI-only interwoven operations', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'source.interwoven-moments', {
      sourceRef: 'source-ref', rawLocator: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'source.interwoven-detail', {
      sourceRef: 'source-ref', momentRef: 'moment-ref', recordUid: 'must-not-forward',
    })

    expect(service.interwovenMoments).toHaveBeenCalledWith('source-ref')
    expect(service.interwovenMomentDetail).toHaveBeenCalledWith('source-ref', 'moment-ref')
  })

  it('dispatches record calendar operations without forwarding raw scope fields', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'calendar.buckets', {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      timezone: 'Asia/Shanghai',
      bucket_scope_uid: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'calendar.records', {
      bucketDate: '2026-08-21',
      timezone: 'Asia/Shanghai',
      limit: 10,
      cursor: { sendAtMillis: 1_787_300_000_000, recordUid: 'record-next' },
      chat_core: { owner_user_id: 999 },
    })

    expect(service.calendarBuckets).toHaveBeenCalledWith({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      timezone: 'Asia/Shanghai',
    })
    expect(service.calendarRecords).toHaveBeenCalledWith({
      bucketDate: '2026-08-21',
      timezone: 'Asia/Shanghai',
      limit: 10,
      cursor: { sendAtMillis: 1_787_300_000_000, recordUid: 'record-next' },
    })
  })

  it('rejects missing or oversized interwoven references', async () => {
    const service = fakeService()

    await expect(dispatchArkmeHostOperation(service as never, 'source.interwoven-detail', {
      sourceRef: 'source-ref', momentRef: '',
    })).rejects.toMatchObject({ code: 'interwoven-param-invalid' })
    await expect(dispatchArkmeHostOperation(service as never, 'source.interwoven-moments', {
      sourceRef: 'x'.repeat(4097),
    })).rejects.toMatchObject({ code: 'interwoven-param-invalid' })
    expect(service.interwovenMomentDetail).not.toHaveBeenCalled()
  })

  it('normalizes rich-send assets and does not forward unknown browser fields', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.send-rich', {
      sourceRef: 'source-1', title: '标题', textContent: '正文', displayKind: 1,
      recordUid: 'record-1', relationUid: 'relation-1', accessToken: 'must-not-forward',
      assets: [{ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 8, fileKind: 1, signedUrl: 'secret' }],
    })
    expect(service.sendSourceRich).toHaveBeenCalledWith('source-1', {
      title: '标题', textContent: '正文', displayKind: 1,
      assets: [{ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 8, fileKind: 1 }],
    }, { recordUid: 'record-1', relationUid: 'relation-1' })
  })

  it('keeps mention-scoped refs on rich sends without forwarding browser-owned identities', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.send-rich', {
      sourceRef: 'source-1', textContent: '@小林 请看', displayKind: 0,
      recordUid: 'record-1', relationUid: 'relation-1',
      humanMentions: [{ mentionRef: 'mention-ref', userId: 999, startIndex: 0, length: 3 }],
    })
    expect(service.sendSourceRich).toHaveBeenCalledWith('source-1', {
      title: '', textContent: '@小林 请看', displayKind: 0,
      assets: [],
      humanMentions: [{ mentionRef: 'mention-ref', startIndex: 0, length: 3 }],
    }, { recordUid: 'record-1', relationUid: 'relation-1' })
  })

  it('normalizes long-article detail, update, and draft operations', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'source.long-article.detail', {
      sourceRef: 'source-1', itemUid: 'record-1', accessToken: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'source.long-article.update', {
      sourceRef: 'source-1', itemUid: 'record-1', title: '标题', textContent: '正文',
      version: 2.8, editDurationMillis: 1200.9, ownerUserId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'source.long-article.draft.put', {
      sourceRef: 'source-1', itemUid: 'record-1', title: '草稿', textContent: '正文', durationMillis: 500,
    })

    expect(service.longArticleDetail).toHaveBeenCalledWith('source-1', 'record-1')
    expect(service.updateLongArticle).toHaveBeenCalledWith('source-1', 'record-1', {
      title: '标题', textContent: '正文', version: 2, editDurationMillis: 1200,
    })
    expect(service.putLongArticleDraft).toHaveBeenCalledWith({
      sourceRef: 'source-1', itemUid: 'record-1', title: '草稿', textContent: '正文',
      durationMillis: 500, updatedAtMillis: expect.any(Number),
    })
  })

  it('dispatches built-in search lanes without forwarding caller account fields', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'search.records', {
      query: '复盘', limit: 12, cursor: 'next-records', searchScope: 'topic', sourceUid: 'topic-1', userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'search.scene', {
      scene: 'image_video', limit: 8, userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'images.list', {
      limit: 50, cursor: 'next-images', userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'search.recordings', {
      query: '北京', limit: 9, userId: 999,
    })

    expect(service.searchRemote).toHaveBeenCalledWith({ query: '复盘', limit: 12, cursor: 'next-records', searchScope: 'topic', sourceUid: 'topic-1' })
    expect(service.searchScene).toHaveBeenCalledWith({ scene: 'image_video', limit: 8 })
    expect(service.searchImages).toHaveBeenCalledWith({ limit: 50, cursor: 'next-images' })
    expect(service.searchRecordings).toHaveBeenCalledWith({ query: '北京', limit: 9 })
  })

  it('keeps AI video list and signed asset resolution in built-in Host operations', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'ai-video.list', {
      limit: 20, statuses: ['succeeded'], cursor: 'next-videos', userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'files.assets', {
      fileAssetUids: ['video-1', 999, 'cover-1'], userId: 999,
    })

    expect(service.aiVideoList).toHaveBeenCalledWith({ limit: 20, statuses: ['succeeded'], cursor: 'next-videos' })
    expect(service.queryFileAssets).toHaveBeenCalledWith(['video-1', 'cover-1'])
  })

  it('dispatches World voiceprint invites without forwarding browser-owned fields', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'world.voiceprint.invite', {
      recordRef: ' world-ref ',
      peerUserId: 999,
      inviteToken: 'must-not-forward',
    })

    expect(service.inviteWorldVoiceprint).toHaveBeenCalledWith('world-ref')
  })

  it('dispatches only the opaque World reference and refresh flag for voiceprint social context', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'world.voiceprint.social-context', {
      recordRef: ' world-ref ', forceRefresh: true, authorUserId: 999, chatSessionUid: 'must-not-forward',
    })

    expect(service.worldVoiceprintSocialContext).toHaveBeenCalledWith('world-ref', { forceRefresh: true })
  })

  it('dispatches a bounded current-account World page', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'world.mine', {
      limit: 999,
      offset: -4,
      userId: 999,
    })

    expect(service.listMyWorldFeed).toHaveBeenCalledWith({ limit: 20, offset: 0 })
  })

  it('dispatches a bounded target-user World page and rejects invalid identities', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'world.user', {
      userId: 7,
      limit: 999,
      offset: -4,
      stableRecordId: 'must-not-forward',
    })
    expect(service.listUserWorldFeed).toHaveBeenCalledWith(7, { limit: 20, offset: 0 })

    await expect(dispatchArkmeHostOperation(service as never, 'world.user', { userId: 0 }))
      .rejects.toMatchObject({ code: 'world-user-id-invalid' })
  })
})

describe('Arko Host API dispatch', () => {
  it('passes only the authoritative run identity to status polling', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'arko.run.status', {
      sessionId: 1024, runUid: 'run-1', assistantMsgId: 999,
    })

    expect(service.arkoRunStatus).toHaveBeenCalledWith(1024, 'run-1')
  })

  it('passes the complete authoritative run identity to cancellation', async () => {
    const service = fakeService()

    await dispatchArkmeHostOperation(service as never, 'arko.cancel', {
      sessionId: 1024, assistantMsgId: 2048, runUid: 'run-1', userId: 999,
    })

    expect(service.arkoCancel).toHaveBeenCalledWith(1024, 2048, 'run-1')
  })
})

describe('plugin update Host API dispatch', () => {
  it('reads and checks update state without touching the Arkme service', async () => {
    const updates = {
      status: vi.fn(async () => ({ availability: 'current' })),
      check: vi.fn(async () => ({ availability: 'available' })),
      acknowledge: vi.fn(async () => ({ acknowledged: true })),
      install: vi.fn(async () => ({ phase: 'preparing' })),
      installStatus: vi.fn(async () => ({ phase: 'installing' })),
    }
    const service = {} as never

    await expect(dispatchArkmeHostOperation(service, 'plugin.update.status', {}, updates as never))
      .resolves.toEqual({ availability: 'current' })
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.check', {}, updates as never))
      .resolves.toEqual({ availability: 'available' })
    expect(updates.check).toHaveBeenCalledWith({ manual: true })
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.acknowledge', {
      snoozeHours: 12,
      latestVersion: 'attacker-controlled',
    }, updates as never)).resolves.toEqual({ acknowledged: true })
    expect(updates.acknowledge).toHaveBeenCalledWith(12)
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.install', {}, updates as never))
      .resolves.toEqual({ phase: 'preparing' })
    await expect(dispatchArkmeHostOperation(service, 'plugin.update.install-status', {}, updates as never))
      .resolves.toEqual({ phase: 'installing' })
  })

  it('rejects invalid snooze values and missing update runtime', async () => {
    const updates = {
      status: vi.fn(), check: vi.fn(), acknowledge: vi.fn(), install: vi.fn(), installStatus: vi.fn(),
    }
    await expect(dispatchArkmeHostOperation({} as never, 'plugin.update.acknowledge', {
      snoozeHours: 25,
    }, updates as never)).rejects.toMatchObject({ code: 'plugin-update-snooze-invalid' })
    expect(updates.acknowledge).not.toHaveBeenCalled()

    await expect(dispatchArkmeHostOperation({} as never, 'plugin.update.status', {}))
      .rejects.toMatchObject({ code: 'plugin-update-unavailable' })
  })
})
