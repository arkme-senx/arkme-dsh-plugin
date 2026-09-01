import { describe, expect, it, vi } from 'vitest'
import { ChatRealtimeService } from '../src/services/chat-realtime-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { SourceService } from '../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 500,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha', interwovenMomentsEnabled: true,
}

function summary(badgeCount: number) {
  return {
    badgeCount,
    mutedUnreadCount: 0,
    sessionCountWithUnread: badgeCount > 0 ? 1 : 0,
    hasAttention: false,
    // Two valid mutations can be generated in the same millisecond.
    summaryVersion: 100,
    updatedAtMillis: 100,
  }
}

describe('Chat attention summary owner', () => {
  it('refreshes the authoritative summary at startup without waiting for IM SSE reconcile', async () => {
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, { async uniqueCode() { return 'secret' } } as StateStore, fetchImpl)
    const readSummary = vi.fn(async () => summary(1))
    const service = new ChatRealtimeService(runtime, {
      chatUnreadBadgeSummary: readSummary,
    } as unknown as SourceService, { chatTimelineItems: vi.fn(async () => []) })

    const stop = service.startChatRealtime()
    await vi.waitFor(() => { expect(readSummary).toHaveBeenCalled() })
    stop()
    service.dispose()
  })

  it('single-flights concurrent summary refreshes', async () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn() as typeof fetch)
    let release = (): void => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const readSummary = vi.fn(async () => { await gate; return summary(3) })
    const service = new ChatRealtimeService(runtime, {
      chatUnreadBadgeSummary: readSummary,
    } as unknown as SourceService, { chatTimelineItems: vi.fn(async () => []) })

    const first = service.refreshAttentionSummary()
    const second = service.refreshAttentionSummary()
    await vi.waitFor(() => { expect(readSummary).toHaveBeenCalledOnce() })
    release()
    await Promise.all([first, second])
    expect(readSummary).toHaveBeenCalledOnce()
  })

  it('retries a failed native badge application with the same summary snapshot', async () => {
    vi.useFakeTimers()
    try {
      const runtime = new ServiceRuntime(config, {
        async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
        async write() {}, async delete() {},
      }, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn() as typeof fetch)
      const readSummary = vi.fn(async () => summary(4))
      const native = {
        showNotification: vi.fn(),
        applyBadgeSummary: vi.fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      }
      const service = new ChatRealtimeService(runtime, {
        chatUnreadBadgeSummary: readSummary,
      } as unknown as SourceService, { chatTimelineItems: vi.fn(async () => []) }, native)

      await service.refreshAttentionSummary()
      expect(native.applyBadgeSummary).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(0)
      expect(readSummary).toHaveBeenCalledTimes(2)
      expect(native.applyBadgeSummary).toHaveBeenCalledTimes(2)
      expect(native.applyBadgeSummary).toHaveBeenLastCalledWith({ count: 4, revision: 100 })
      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reapplies the latest known summary when a retry reads a stale replica version', async () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn() as typeof fetch)
    const summaries = [summary(4), { ...summary(2), summaryVersion: 99, updatedAtMillis: 99 }]
    const native = {
      showNotification: vi.fn(), resetBadgeCount: vi.fn(async () => true),
      applyBadgeSummary: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    }
    const service = new ChatRealtimeService(runtime, {
      chatUnreadBadgeSummary: vi.fn(async () => summaries.shift() ?? summary(4)),
    } as unknown as SourceService, { chatTimelineItems: vi.fn(async () => []) }, native)

    await service.refreshAttentionSummary()
    await service.refreshAttentionSummary()

    expect(native.applyBadgeSummary).toHaveBeenNthCalledWith(1, { count: 4, revision: 100 })
    expect(native.applyBadgeSummary).toHaveBeenNthCalledWith(2, { count: 4, revision: 100 })
    service.dispose()
  })

  it('keeps the current account badge when a transient summary read fails', async () => {
    const sessions = {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn() as typeof fetch)
    const readSummary = vi.fn()
      .mockResolvedValueOnce(summary(5))
      .mockRejectedValueOnce(new Error('temporary network failure'))
    const native = {
      showNotification: vi.fn(), resetBadgeCount: vi.fn(async () => true), applyBadgeSummary: vi.fn(async () => true),
    }
    const service = new ChatRealtimeService(runtime, {
      chatUnreadBadgeSummary: readSummary,
    } as unknown as SourceService, { chatTimelineItems: vi.fn(async () => []) }, native)
    const badgeCounts: number[] = []
    service.subscribeChatRealtime(event => {
      if (event.type === 'attention-summary') badgeCounts.push(event.summary.badgeCount)
    })

    await service.refreshAttentionSummary()
    await service.refreshAttentionSummary()

    expect(badgeCounts).toEqual([5])
    expect(native.resetBadgeCount).not.toHaveBeenCalled()
    service.dispose()
  })

  it('runs one trailing refresh when a mutation arrives after the first snapshot read started', async () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn() as typeof fetch)
    let release = (): void => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let reads = 0
    const readSummary = vi.fn(async () => {
      reads += 1
      if (reads === 1) await gate
      return summary(reads)
    })
    const service = new ChatRealtimeService(runtime, {
      chatUnreadBadgeSummary: readSummary,
    } as unknown as SourceService, { chatTimelineItems: vi.fn(async () => []) })
    const badgeCounts: number[] = []
    service.subscribeChatRealtime(event => {
      if (event.type === 'attention-summary') badgeCounts.push(event.summary.badgeCount)
    })

    const first = service.refreshAttentionSummary()
    await vi.waitFor(() => { expect(readSummary).toHaveBeenCalledOnce() })
    const racedMutation = service.refreshAttentionSummary()
    release()
    await Promise.all([first, racedMutation])

    expect(readSummary).toHaveBeenCalledTimes(2)
    expect(badgeCounts).toEqual([1, 2])
  })

  it('keeps a trailing refresh dirty when another mutation arrives during that trailing read', async () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn() as typeof fetch)
    const releases = new Map<number, () => void>()
    const gates = new Map<number, Promise<void>>()
    for (const index of [1, 2]) {
      gates.set(index, new Promise<void>(resolve => { releases.set(index, resolve) }))
    }
    let reads = 0
    const readSummary = vi.fn(async () => {
      reads += 1
      await gates.get(reads)
      return summary(reads)
    })
    const service = new ChatRealtimeService(runtime, {
      chatUnreadBadgeSummary: readSummary,
    } as unknown as SourceService, { chatTimelineItems: vi.fn(async () => []) })
    const badgeCounts: number[] = []
    service.subscribeChatRealtime(event => {
      if (event.type === 'attention-summary') badgeCounts.push(event.summary.badgeCount)
    })

    const first = service.refreshAttentionSummary()
    await vi.waitFor(() => { expect(reads).toBe(1) })
    const secondTrigger = service.refreshAttentionSummary()
    releases.get(1)?.()
    await vi.waitFor(() => { expect(reads).toBe(2) })
    const thirdTrigger = service.refreshAttentionSummary()
    releases.get(2)?.()
    await Promise.all([first, secondTrigger, thirdTrigger])

    expect(readSummary).toHaveBeenCalledTimes(3)
    expect(badgeCounts).toEqual([1, 2, 3])
  })

  it('drops an old-account projection batch that resolves after account reset', async () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/api/v1/chats/display-snapshots')) {
        return new Response(JSON.stringify({ code: 200, data: { items: [{ session: { chat_session_uid: 'chat-1' } }] } }))
      }
      if (path.endsWith('/api/v1/chat/timeline/tail')) {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }))
      }
      throw new Error(`unexpected ${path}`)
    }) as typeof fetch)
    let release = (): void => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const setChatSourceByKey = vi.fn()
    const source = {
      cachedChatSourceByKey: vi.fn(),
      chatSourceFromBundle: vi.fn(async () => {
        await gate
        return {
          sourceRef: 'old-account-ref', sourceKey: 'stable-key', kind: 'group_chat' as const,
          displayName: '旧账号群', activeAtMillis: 1, unreadCount: 1,
          badgeUnreadCount: 1, notificationAllowed: true, isMuted: false,
        }
      }),
      setChatSourceByKey,
      chatDirectorySourceKey: vi.fn(async () => 'stable-key'),
      invalidateSourceListCache: vi.fn(),
    } as unknown as SourceService
    const native = {
      showNotification: vi.fn(), applyBadgeSummary: vi.fn(async () => true), resetBadgeCount: vi.fn(async () => true),
    }
    const service = new ChatRealtimeService(runtime, source, {
      chatTimelineItems: vi.fn(async () => []),
    }, native)
    const events: string[] = []
    service.subscribeChatRealtime(event => { events.push(event.type) })

    const pending = service.refreshChatSessionProjectionBatch([[
      'chat-1', { latestSequence: 1, notificationHints: [] },
    ]])
    await vi.waitFor(() => { expect(source.chatSourceFromBundle).toHaveBeenCalled() })
    service.resetAttentionSummary()
    release()
    await expect(pending).resolves.toEqual([])

    expect(setChatSourceByKey).not.toHaveBeenCalled()
    expect(events).not.toContain('sessions-delta')
    expect(native.showNotification).not.toHaveBeenCalled()
  })

  it('feeds Browser and native from the same summary and clears both on account reset', async () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 1, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, { async uniqueCode() { return 'secret' } } as StateStore, vi.fn() as typeof fetch)
    const summaries = [summary(1), summary(2)]
    const source = {
      chatUnreadBadgeSummary: vi.fn(async () => summaries.shift() ?? summary(2)),
    } as unknown as SourceService
    const native = {
      showNotification: vi.fn(),
      applyBadgeSummary: vi.fn(async () => true),
      resetBadgeCount: vi.fn(async () => true),
    }
    const service = new ChatRealtimeService(runtime, source, {
      chatTimelineItems: vi.fn(async () => []),
    }, native)
    const events: Array<{ type: string; summary?: { badgeCount: number } }> = []
    service.subscribeChatRealtime(event => { events.push(event) })

    await service.refreshAttentionSummary()
    await service.refreshAttentionSummary()
    await service.refreshAttentionSummary()

    expect(events.filter(event => event.type === 'attention-summary').map(event => event.summary?.badgeCount)).toEqual([1, 2])
    expect(native.applyBadgeSummary).toHaveBeenNthCalledWith(1, { count: 1, revision: 100 })
    expect(native.applyBadgeSummary).toHaveBeenNthCalledWith(2, { count: 2, revision: 100 })
    expect(native.applyBadgeSummary).toHaveBeenNthCalledWith(3, { count: 2, revision: 100 })
    expect(service.chatRealtimeInitialEvent()).toMatchObject({
      type: 'reconcile', attentionSummary: { badgeCount: 2, summaryVersion: 100 },
    })

    service.resetAttentionSummary()
    expect(events.at(-1)).toMatchObject({ type: 'attention-summary', summary: { badgeCount: 0 } })
    expect(native.resetBadgeCount).toHaveBeenCalledOnce()
  })
})
