import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

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
    aiVideoList: vi.fn(async (input: unknown) => input),
    queryFileAssets: vi.fn(async (input: unknown) => input),
    arkoRunStatus: vi.fn(async () => ({ status: 'running' })),
    arkoCancel: vi.fn(async () => ({ status: 'cancel_requested' })),
    interwovenMoments: vi.fn(async (sourceRef: string) => ({ sourceRef })),
    interwovenMomentDetail: vi.fn(async (sourceRef: string, momentRef: string) => ({ sourceRef, momentRef })),
    sendSourceRich: vi.fn(async () => undefined),
    longArticleDetail: vi.fn(async (sourceRef: string, itemUid: string) => ({ sourceRef, itemUid })),
    updateLongArticle: vi.fn(async (_sourceRef: string, _itemUid: string, input: unknown) => input),
    getLongArticleDraft: vi.fn(async () => undefined),
    putLongArticleDraft: vi.fn(async () => undefined),
    removeLongArticleDraft: vi.fn(async () => undefined),
  }
}

describe('outgoing call Host API dispatch', () => {
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
    await dispatchArkmeHostOperation(service as never, 'search.scene', {
      scene: 'image_video', mediaKind: 'image', limit: 50, cursor: 'next-images', userId: 999,
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
