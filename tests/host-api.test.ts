import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'

function fakeService() {
  return {
    prepareOutgoingCall: vi.fn(async (input: unknown) => input),
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
    listSourceMembers: vi.fn(async (sourceRef: string, options: unknown) => ({ sourceRef, options })),
    sourceMemberRecords: vi.fn(async (sourceRef: string, memberRef: string, mode: string, options: unknown) => ({ sourceRef, memberRef, mode, options })),
    openPrivateChatFromMember: vi.fn(async (sourceRef: string, memberRef: string) => ({ sourceRef, memberRef })),
    sendSourceText: vi.fn(async (_sourceRef: string, _text: string, options: unknown) => options),
    sendSourceRich: vi.fn(async () => undefined),
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
    listMyWorldFeed: vi.fn(async (input: unknown) => input),
    listUserWorldFeed: vi.fn(async (_userId: number, input: unknown) => input),
    publishWorldText: vi.fn(async (input: unknown) => input),
    publishWorldFileAssets: vi.fn(async (input: unknown) => input),
    worldVoiceprintSocialContext: vi.fn(async (recordRef: string, options: unknown) => ({ recordRef, options })),
    inviteWorldVoiceprint: vi.fn(async (recordRef: string) => ({ sent: true, peerDisplayName: '小林', recordRef })),
  }
}

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
      humanMentions: [{ memberRef: 'member-ref', startIndex: 0, length: 3, userId: 999 }],
    })
    expect(service.sendSourceText).toHaveBeenCalledWith('source-ref', '@小林 请看', {
      recordUid: 'record-ref',
      relationUid: 'relation-ref',
      humanMentions: [{ memberRef: 'member-ref', startIndex: 0, length: 3 }],
    })
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

  it('dispatches group and Bot quick-add through strict domain adapters', async () => {
    const service = fakeService()
    await dispatchArkmeHostOperation(service as never, 'group.create', {
      title: '项目群', clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', userId: 999,
    })
    await dispatchArkmeHostOperation(service as never, 'bots.create', {
      name: '总结助手', provider: 'openclaw', description: '总结群聊',
      avatar: 'file_asset://avatar-asset-1', token: 'must-not-forward',
    })
    expect(service.createGroup).toHaveBeenCalledWith('项目群', 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b')
    expect(service.createBotSummary).toHaveBeenCalledWith({
      name: '总结助手', provider: 'openclaw', description: '总结群聊', avatar: 'file_asset://avatar-asset-1',
    })

    await expect(dispatchArkmeHostOperation(service as never, 'bots.create', {
      name: '错误 Bot', provider: 'arbitrary',
    })).rejects.toMatchObject({ code: 'bot-provider-unsupported' })

    await expect(dispatchArkmeHostOperation(service as never, 'bots.create', {
      name: '错误头像 Bot', provider: 'openclaw', avatar: 'https://untrusted.example/avatar.png',
    })).rejects.toMatchObject({ code: 'bot-avatar-invalid' })
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
