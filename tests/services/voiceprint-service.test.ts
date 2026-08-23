import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { VoiceprintService, type ArkmeVoiceprintProfileReader } from '../../src/services/voiceprint-service.js'
import { encodeMonoPcm16Wav } from '../../src/client/voiceprint-recorder.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

const sessions: ArkmeSessionStore = {
  async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
  async write() {}, async delete() {},
}

const state = { async uniqueCode() { return 'device-secret' } } as StateStore

function json(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
}

function profileReader(): ArkmeVoiceprintProfileReader {
  return {
    async publicProfileSummariesByUserIds(userIds) {
      return new Map(userIds.map(userId => [userId, {
        userId, displayName: userId === 7 ? '小林' : `用户 ${String(userId)}`, avatarUrl: 'https://avatar.test/a.png',
      }]))
    },
    async sealProfileImageRef(viewerUserId, targetUserId) {
      return `avatar:${String(viewerUserId)}:${String(targetUserId)}`
    },
  }
}

describe('VoiceprintService', () => {
  it('projects my voiceprint without leaking the backend speaker id', async () => {
    const fetchImpl = vi.fn(async () => json({
      has_voiceprint: true, speaker_id: '0123456789abcdef01234567', nick_name: '我的声音', updated_at: 123,
      can_identify: true, can_play: false, can_restore_playback: true, enrollment_status: 'ready', pending_session_id: '',
    })) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.myVoiceprint()).resolves.toEqual({
      hasVoiceprint: true, nickname: '我的声音', updatedAtMillis: 123, canIdentify: true, canPlay: false,
      canRestorePlayback: true, enrollmentStatus: 'ready', enrollmentPending: false,
    })
    expect(await fetchImpl.mock.calls[0]?.[1]?.body).toBe('{}')
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://audio.test/api/v1/audio/voiceprint/my')
  })

  it('keeps re-enrollment pending while the backend returns a pending session id', async () => {
    const fetchImpl = vi.fn(async () => json({
      has_voiceprint: true, speaker_id: '0123456789abcdef01234567', nick_name: '我的声音', updated_at: 123,
      can_identify: true, can_play: true, can_restore_playback: false,
      enrollment_status: 'ready', pending_session_id: 'pending-reenrollment-session',
    })) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.myVoiceprint()).resolves.toMatchObject({
      enrollmentStatus: 'ready', enrollmentPending: true,
    })
  })

  it('keeps outbound grants separate, hydrates profiles in one batch, and seals grant refs', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return json({ grant_ls: [{
        owner_user_id: 42, grantee_user_id: 7, identify_enabled: true, play_enabled: true, status: 1,
        play_consent_version: 'voiceprint-play-v1', play_grant_source: 2, play_granted_at: 100, update_at: 101,
      }], next_cursor: 'next-1', has_more: true })
    }) as typeof fetch
    const profiles = profileReader()
    const batch = vi.spyOn(profiles, 'publicProfileSummariesByUserIds')
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profiles)

    const page = await service.outboundGrants({ cursor: '', limit: 20 })

    expect(bodies).toEqual([{ direction: 'outbound', cursor: '', limit: 20 }])
    expect(batch).toHaveBeenCalledOnce()
    expect(batch.mock.calls[0]?.[0]).toEqual([7])
    expect(page).toMatchObject({
      hasMore: true, nextCursor: 'next-1', items: [{
        displayName: '小林', avatarRef: 'avatar:42:7', identifyEnabled: true, playEnabled: true,
        grantedAtMillis: 100, updatedAtMillis: 101,
      }],
    })
    expect(page.items[0]?.grantRef).toMatch(/^arkme-voiceprint-grant-v1\./)
    expect(page.items[0]).not.toHaveProperty('ownerUserId')
    expect(page.items[0]).not.toHaveProperty('granteeUserId')
  })

  it('keeps grant management available when optional public profiles are unavailable', async () => {
    const fetchImpl = vi.fn(async () => json({ grant_ls: [{
      owner_user_id: 42, grantee_user_id: 7, identify_enabled: true, play_enabled: true, status: 1,
      play_granted_at: 100, update_at: 101,
    }], next_cursor: '', has_more: false })) as typeof fetch
    const profiles = profileReader()
    profiles.publicProfileSummariesByUserIds = vi.fn(async () => { throw new Error('profile unavailable') })
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profiles)

    await expect(service.outboundGrants({ cursor: '', limit: 20 })).resolves.toMatchObject({
      items: [{ displayName: '用户资料不可用', playEnabled: true }],
    })
  })

  it('keeps grant management available when optional avatar references cannot be sealed', async () => {
    const fetchImpl = vi.fn(async () => json({ grant_ls: [{
      owner_user_id: 42, grantee_user_id: 7, identify_enabled: true, play_enabled: true, status: 1,
      play_granted_at: 100, update_at: 101,
    }], next_cursor: '', has_more: false })) as typeof fetch
    const profiles = profileReader()
    profiles.sealProfileImageRef = vi.fn(async () => { throw new Error('avatar unavailable') })
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profiles)

    const page = await service.outboundGrants({ cursor: '', limit: 20 })

    expect(page).toMatchObject({ items: [{ displayName: '小林', playEnabled: true }] })
    expect(page.items[0]).not.toHaveProperty('avatarRef')
  })

  it('rejects deleted grant rows instead of projecting a transitional client status', async () => {
    const fetchImpl = vi.fn(async () => json({ grant_ls: [{
      owner_user_id: 42, grantee_user_id: 7, identify_enabled: false, play_enabled: false, status: 2,
      play_granted_at: 100, update_at: 101,
    }], next_cursor: '', has_more: false })) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.outboundGrants({ cursor: '', limit: 20 }))
      .rejects.toMatchObject({ code: 'voiceprint-grant-contract-invalid' })
  })

  it('keeps recognized people distinct from grants, including grant-only rows', async () => {
    const fetchImpl = vi.fn(async () => json({
      capability_enabled: true,
      items: [
        { speaker_id: '', target_user_id: 7, display_name: '声纹里的小林', play_granted: true, preview_available: true, can_invite: false },
        { speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '会议中的同事', play_granted: false, preview_available: false, can_invite: true },
      ],
      next_cursor: '', has_more: false,
    })) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    const page = await service.recognizedPeople({ cursor: '', limit: 20 })

    expect(page).toMatchObject({
      hasMore: false, nextCursor: '',
      items: [
        { displayName: '声纹里的小林', identityKind: 'authorized_user', playGranted: true, previewAvailable: true, avatarRef: 'avatar:42:7', inviteTargetSelectionRequired: false },
        { displayName: '会议中的同事', identityKind: 'speaker', playGranted: false, canInvite: true, inviteTargetSelectionRequired: true },
      ],
    })
    expect(page.items.every(item => item.personRef.startsWith('arkme-voiceprint-person-v1.'))).toBe(true)
    expect(page.items.every(item => !('speakerId' in item) && !('targetUserId' in item))).toBe(true)
    expect(page.items.every(item => !('grantRef' in item))).toBe(true)
  })

  it('rejects a recognized speaker state that contradicts the owner contract', async () => {
    const fetchImpl = vi.fn(async () => json({
      capability_enabled: true,
      items: [{
        speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '暂不可邀请的声音',
        play_granted: false, preview_available: false, can_invite: false,
      }],
      next_cursor: '', has_more: false,
    })) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.recognizedPeople({ cursor: '', limit: 20 }))
      .rejects.toMatchObject({ code: 'voiceprint-person-contract-invalid' })
  })

  it('rejects a recognized-person projection that points back to the signed-in user', async () => {
    const fetchImpl = vi.fn(async () => json({
      capability_enabled: true,
      items: [{
        speaker_id: '0123456789abcdef01234567', target_user_id: 42, display_name: '错误的本人投影',
        play_granted: false, preview_available: false, can_invite: true,
      }],
      next_cursor: '', has_more: false,
    })) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.recognizedPeople({ cursor: '', limit: 20 }))
      .rejects.toMatchObject({ code: 'voiceprint-person-contract-invalid' })
  })

  it('opens a person ref into exactly one backend selector and rejects grant refs', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      if (path.endsWith('/list')) {
        return json({ capability_enabled: true, items: [
          { speaker_id: '', target_user_id: 7, display_name: '小林', play_granted: true, preview_available: true, can_invite: false },
          { speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '会议中的同事', play_granted: false, preview_available: false, can_invite: true },
        ], next_cursor: '', has_more: false })
      }
      if (path.endsWith('/grants')) {
        return json({ grant_ls: [{
          owner_user_id: 42, grantee_user_id: 7, identify_enabled: true, play_enabled: true, status: 1,
          play_consent_version: 'voiceprint-play-v1', play_grant_source: 2, play_granted_at: 100, update_at: 101,
        }], next_cursor: '', has_more: false })
      }
      if (path.endsWith('/detail') && 'speaker_id' in body) {
        return json({ speaker_id: body.speaker_id, target_user_id: 0, display_name: '会议中的同事', play_granted: false, preview_available: false, can_invite: true, claim_required: true })
      }
      return json({ speaker_id: '', target_user_id: 7, display_name: '小林', play_granted: true, preview_available: true, can_invite: false, claim_required: false })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const people = await service.recognizedPeople({ cursor: '', limit: 20 })

    const authorized = await service.recognizedPerson(people.items[0]!.personRef)
    const speaker = await service.recognizedPerson(people.items[1]!.personRef)
    expect(authorized).toMatchObject({ identityKind: 'authorized_user', inviteTargetSelectionRequired: false })
    expect(speaker).toMatchObject({ identityKind: 'speaker', inviteTargetSelectionRequired: true })
    expect(authorized).not.toHaveProperty('claimRequired')
    expect(speaker).not.toHaveProperty('claimRequired')
    const grants = await service.outboundGrants({ cursor: '', limit: 20 })
    await expect(service.recognizedPerson(grants.items[0]!.grantRef)).rejects.toMatchObject({ code: 'voiceprint-person-ref-invalid' })
    await expect(service.recognizedPerson(`arkme-voiceprint-person-v1.${'a'.repeat(3_000)}.signature`))
      .rejects.toMatchObject({ code: 'voiceprint-person-ref-invalid' })

    expect(calls.filter(call => call.path.endsWith('/detail')).map(call => call.body)).toEqual([
      { target_user_id: 7 },
      { speaker_id: '0123456789abcdef01234567' },
    ])
  })

  it('rejects detail data that mixes a bound person with claim-required semantics', async () => {
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/list')) return json({ capability_enabled: true, items: [{
        speaker_id: '0123456789abcdef01234567', target_user_id: 7, display_name: '小林',
        play_granted: false, preview_available: false, can_invite: true,
      }], next_cursor: '', has_more: false })
      return json({
        speaker_id: '0123456789abcdef01234567', target_user_id: 7, display_name: '小林',
        play_granted: false, preview_available: false, can_invite: true, claim_required: true,
      })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const people = await service.recognizedPeople({ cursor: '', limit: 20 })

    await expect(service.recognizedPerson(people.items[0]!.personRef))
      .rejects.toMatchObject({ code: 'voiceprint-person-contract-invalid' })
  })

  it('maps a no-longer-visible recognized person to a stable domain error', async () => {
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/list')) return json({ capability_enabled: true, items: [{
        speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '会议中的同事',
        play_granted: false, preview_available: false, can_invite: true,
      }], next_cursor: '', has_more: false })
      return new Response(JSON.stringify({ code: 1003, message: '无权访问' }), { status: 200 })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const people = await service.recognizedPeople({ cursor: '', limit: 20 })

    await expect(service.recognizedPerson(people.items[0]!.personRef))
      .rejects.toMatchObject({ code: 'voiceprint-person-unavailable', httpStatus: 410 })
  })

  it('rejects oversized opaque references before reading signing material', async () => {
    const uniqueCode = vi.fn(async () => 'device-secret')
    const service = new VoiceprintService(
      new ServiceRuntime(config, sessions, { uniqueCode } as StateStore, vi.fn() as typeof fetch), profileReader(),
    )

    await expect(service.recognizedPerson(`arkme-voiceprint-person-v1.${'a'.repeat(3_000)}.signature`))
      .rejects.toMatchObject({ code: 'voiceprint-person-ref-invalid' })
    await expect(service.revokePlaybackGrant(`arkme-voiceprint-grant-v1.${'a'.repeat(3_000)}.signature`))
      .rejects.toMatchObject({ code: 'voiceprint-grant-ref-invalid' })
    expect(uniqueCode).not.toHaveBeenCalled()
  })

  it('rejects person and grant references after an account switch before any remote request', async () => {
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/grants')) return json({ grant_ls: [{
        owner_user_id: 42, grantee_user_id: 7, identify_enabled: true, play_enabled: true, status: 1,
        play_granted_at: 100, update_at: 101,
      }], next_cursor: '', has_more: false })
      return json({ capability_enabled: true, items: [{
        speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '会议中的同事',
        play_granted: false, preview_available: false, can_invite: true,
      }], next_cursor: '', has_more: false })
    }) as typeof fetch
    const first = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const [people, grants] = await Promise.all([
      first.recognizedPeople({ cursor: '', limit: 20 }),
      first.outboundGrants({ cursor: '', limit: 20 }),
    ])
    const switchedSessions: ArkmeSessionStore = {
      async read() { return { userId: 99, accessToken: 'other-access', refreshToken: 'other-refresh' } },
      async write() {}, async delete() {},
    }
    const switchedFetch = vi.fn() as typeof fetch
    const switched = new VoiceprintService(
      new ServiceRuntime(config, switchedSessions, state, switchedFetch), profileReader(),
    )

    await expect(switched.recognizedPerson(people.items[0]!.personRef))
      .rejects.toMatchObject({ code: 'voiceprint-person-ref-invalid', httpStatus: 403 })
    await expect(switched.revokePlaybackGrant(grants.items[0]!.grantRef))
      .rejects.toMatchObject({ code: 'voiceprint-grant-ref-invalid', httpStatus: 403 })
    expect(switchedFetch).not.toHaveBeenCalled()
  })

  it('loads voiceprint assets only for speaker projections and never invents a target-user selector', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      if (path.endsWith('/list') && !path.includes('/voiceprints/')) {
        return json({ capability_enabled: true, items: [
          { speaker_id: '', target_user_id: 7, display_name: '小林', play_granted: true, preview_available: true, can_invite: false },
          { speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '会议中的同事', play_granted: false, preview_available: false, can_invite: true },
        ], next_cursor: '', has_more: false })
      }
      return json({ items: [
        { voiceprint_id: 'authorized-ref', kind: 3, is_authorized: true, hit_count: 0, created_at: 100 },
        { voiceprint_id: 'local-ref', kind: 1, is_authorized: false, hit_count: 9, created_at: 90 },
        { voiceprint_id: 'legacy-ref', kind: 2, is_authorized: false, hit_count: 2 },
      ] })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const people = await service.recognizedPeople({ cursor: '', limit: 20 })

    await expect(service.recognizedPersonVoiceprints(people.items[0]!.personRef))
      .rejects.toMatchObject({ code: 'voiceprint-library-unavailable' })
    await expect(service.recognizedPersonVoiceprints(people.items[1]!.personRef)).resolves.toEqual({ items: [
      { kind: 'authorized', hitCount: 0, createdAtMillis: 100 },
      { kind: 'local', hitCount: 9, createdAtMillis: 90 },
      { kind: 'legacy', hitCount: 2 },
    ] })
    expect(calls.filter(call => call.path.includes('/voiceprints/list')).map(call => call.body)).toEqual([
      { speaker_id: '0123456789abcdef01234567' },
    ])
  })

  it('creates the same compact invitation URL contract as mobile', async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ scope: 2 })
      return json({
        invite_token: 'long.invite.token', preview_token: 'long.preview.token',
        short_invite_token: 'abcdefghijklmnopqrstuv', short_preview_token: 'ABCDEFGHIJKLMNOPQRSTUV',
        expires_at: 999_999, scope: 2,
      })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.createInvitation()).resolves.toEqual({
      inviteUrl: 'https://jotmo-app.senguo.me/v?p=ABCDEFGHIJKLMNOPQRSTUV#t=abcdefghijklmnopqrstuv',
      expiresAtMillis: 999_999,
    })
  })

  it('invalidates cached readiness before enrollment so an uncertain write can be reconciled', async () => {
    let statusCalls = 0
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/voiceprint/my')) {
        statusCalls += 1
        return json({
          has_voiceprint: false, can_identify: false, can_play: false, can_restore_playback: false,
          enrollment_status: statusCalls === 1 ? 'none' : 'processing',
          pending_session_id: statusCalls === 1 ? '' : 'accepted-session',
        })
      }
      throw new Error('connection reset after upload')
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const wav = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)

    await expect(service.myVoiceprint()).resolves.toMatchObject({ enrollmentPending: false })
    await expect(service.enrollWav({ wav, durationMs: 3_000 }))
      .rejects.toMatchObject({ code: 'arkme-network-error' })
    await expect(service.myVoiceprint()).resolves.toMatchObject({ enrollmentPending: true })
    expect(statusCalls).toBe(2)
  })

  it('creates a recognized-person invitation through a separately resolved contact target', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      if (path.endsWith('/list')) return json({ capability_enabled: true, items: [{
        speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '会议中的同事',
        play_granted: false, preview_available: false, can_invite: true,
      }], next_cursor: '', has_more: false })
      if (path.endsWith('/detail')) return json({
        speaker_id: '0123456789abcdef01234567', target_user_id: 0, display_name: '会议中的同事',
        play_granted: false, preview_available: false, can_invite: true, claim_required: true,
      })
      return json({
        invite_token: 'long.invite.token', preview_token: 'long.preview.token',
        short_invite_token: 'abcdefghijklmnopqrstuv', short_preview_token: 'ABCDEFGHIJKLMNOPQRSTUV',
        token_version: 2, speaker_id: '0123456789abcdef01234567', target_user_id: 7,
        claim_required: true, scope: 2, expires_at: 999_999,
      })
    }) as typeof fetch
    const resolveRegisteredContactUserId = vi.fn(async () => 7)
    const service = new VoiceprintService(
      new ServiceRuntime(config, sessions, state, fetchImpl), profileReader(), { resolveRegisteredContactUserId },
    )
    const people = await service.recognizedPeople({ cursor: '', limit: 20 })

    await expect(service.createRecognizedPersonInvitation(
      people.items[0]!.personRef, 'arkme-contact-v1.ephemeral',
    )).resolves.toEqual({
      inviteUrl: 'https://jotmo-app.senguo.me/v?p=ABCDEFGHIJKLMNOPQRSTUV#t=abcdefghijklmnopqrstuv',
      expiresAtMillis: 999_999,
    })
    expect(resolveRegisteredContactUserId).toHaveBeenCalledWith(
      'arkme-contact-v1.ephemeral', expect.objectContaining({ userId: 42 }), undefined,
    )
    expect(calls.find(call => call.path.endsWith('/detail'))?.body).toEqual({
      speaker_id: '0123456789abcdef01234567',
    })
    expect(calls.find(call => call.path.endsWith('/invites/create'))?.body).toEqual({
      speaker_id: '0123456789abcdef01234567', target_user_id: 7,
    })
  })

  it('creates a bound-person invitation without accepting or sending a replacement contact target', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      if (path.endsWith('/list')) return json({ capability_enabled: true, items: [{
        speaker_id: '0123456789abcdef01234567', target_user_id: 7, display_name: '小林',
        play_granted: false, preview_available: false, can_invite: true,
      }], next_cursor: '', has_more: false })
      if (path.endsWith('/detail')) return json({
        speaker_id: '0123456789abcdef01234567', target_user_id: 7, display_name: '小林',
        play_granted: false, preview_available: false, can_invite: true, claim_required: false,
      })
      return json({
        invite_token: 'long.invite.token', preview_token: 'long.preview.token',
        short_invite_token: 'abcdefghijklmnopqrstuv', short_preview_token: 'ABCDEFGHIJKLMNOPQRSTUV',
        token_version: 2, speaker_id: '0123456789abcdef01234567', target_user_id: 7,
        claim_required: false, scope: 2, expires_at: 999_999,
      })
    }) as typeof fetch
    const resolveRegisteredContactUserId = vi.fn(async () => 9)
    const service = new VoiceprintService(
      new ServiceRuntime(config, sessions, state, fetchImpl), profileReader(), { resolveRegisteredContactUserId },
    )
    const people = await service.recognizedPeople({ cursor: '', limit: 20 })

    await expect(service.createRecognizedPersonInvitation(
      people.items[0]!.personRef, undefined,
    )).resolves.toMatchObject({ expiresAtMillis: 999_999 })
    await expect(service.createRecognizedPersonInvitation(
      people.items[0]!.personRef, 'arkme-contact-v1.replacement',
    )).rejects.toMatchObject({ code: 'voiceprint-invite-target-unexpected' })

    expect(resolveRegisteredContactUserId).not.toHaveBeenCalled()
    expect(calls.find(call => call.path.endsWith('/invites/create'))?.body).toEqual({
      speaker_id: '0123456789abcdef01234567',
    })
  })

  it('revokes only an outbound grant ref and confirms the idempotent result', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      if (path.endsWith('/grants')) return json({ grant_ls: [{
        owner_user_id: 42, grantee_user_id: 7, identify_enabled: true, play_enabled: true, status: 1,
        update_at: 101,
      }], next_cursor: '', has_more: false })
      return json({ revoked: true })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const grants = await service.outboundGrants({ cursor: '', limit: 20 })

    await expect(service.revokePlaybackGrant(grants.items[0]!.grantRef)).resolves.toEqual({ revoked: true })
    await expect(service.revokePlaybackGrant('arkme-voiceprint-person-v1.invalid.invalid'))
      .rejects.toMatchObject({ code: 'voiceprint-grant-ref-invalid' })
    await expect(service.revokePlaybackGrant(`arkme-voiceprint-grant-v1.${'a'.repeat(3_000)}.signature`))
      .rejects.toMatchObject({ code: 'voiceprint-grant-ref-invalid' })
    expect(calls.find(call => call.path.endsWith('/set-scope'))?.body).toEqual({
      grantee_user_id: 7, scope: 2, enabled: false,
    })
  })

  it('restores playback without leaking the self speaker id', async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({})
      return json({ speaker_id: '0123456789abcdef01234567', can_play: true, restored: true, updated_at: 456 })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.restorePlayback()).resolves.toEqual({ canPlay: true, restored: true, updatedAtMillis: 456 })
  })

  it('invalidates cached readiness before restore so an uncertain write can be reconciled', async () => {
    let statusCalls = 0
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/voiceprint/my')) {
        statusCalls += 1
        return json({
          has_voiceprint: true, nick_name: '我的声音', updated_at: 123,
          can_identify: true, can_play: statusCalls > 1, can_restore_playback: statusCalls === 1,
          enrollment_status: 'ready', pending_session_id: '',
        })
      }
      throw new Error('connection reset after restore')
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())

    await expect(service.myVoiceprint()).resolves.toMatchObject({ canPlay: false, canRestorePlayback: true })
    await expect(service.restorePlayback()).rejects.toMatchObject({ code: 'arkme-network-error' })
    await expect(service.myVoiceprint()).resolves.toMatchObject({ canPlay: true, canRestorePlayback: false })
    expect(statusCalls).toBe(2)
  })

  it('enrolls one bounded WAV sample through multipart without exposing internal session ids', async () => {
    const fetchImpl = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://audio.test/api/v1/audio/voiceprint/enroll-from-audio')
      expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
      const form = init?.body as FormData
      expect(form.get('duration_ms')).toBe('3000')
      expect(form.get('audio_file')).toBeInstanceOf(Blob)
      return json({
        session_id: 'internal-session', child_id: 'internal-child', status: 'processing', clone_ok: true, updated_at: 789,
      })
    }) as typeof fetch
    const service = new VoiceprintService(new ServiceRuntime(config, sessions, state, fetchImpl), profileReader())
    const wav = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)

    await expect(service.enrollWav({ wav, durationMs: 3000 })).resolves.toEqual({
      status: 'processing', cloneReady: true, updatedAtMillis: 789,
    })
    await expect(service.enrollWav({ wav, durationMs: 2999 }))
      .rejects.toMatchObject({ code: 'voiceprint-enrollment-input-invalid' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects a bound enrollment if the signed-in account changes before upload', async () => {
    let currentUserId = 42
    const switchingSessions: ArkmeSessionStore = {
      async read() { return { userId: currentUserId, accessToken: `access-${String(currentUserId)}`, refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn() as typeof fetch
    const service = new VoiceprintService(
      new ServiceRuntime(config, switchingSessions, state, fetchImpl), profileReader(),
    )
    const enrollment = await service.bindEnrollment()
    currentUserId = 99
    const wav = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)

    await expect(enrollment.enrollVoiceprintWav({ wav, durationMs: 3_000 }))
      .rejects.toMatchObject({ code: 'account-changed', httpStatus: 409 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
