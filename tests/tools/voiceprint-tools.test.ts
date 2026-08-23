import { describe, expect, it, vi } from 'vitest'
import { voiceprintToolModules } from '../../src/tools/business/voiceprint/index.js'
import type { ArkmeVoiceprintToolPort } from '../../src/tools/ports/voiceprint.js'

function fixture(): ArkmeVoiceprintToolPort {
  return {
    myVoiceprint: vi.fn(async () => ({
      hasVoiceprint: true, nickname: '我的声音', updatedAtMillis: 1, canIdentify: true, canPlay: true,
      canRestorePlayback: false, enrollmentStatus: 'ready' as const, enrollmentPending: false,
    })),
    outboundVoiceprintGrants: vi.fn(async () => ({ items: [], nextCursor: '', hasMore: false })),
    recognizedVoiceprintPeople: vi.fn(async () => ({ items: [], nextCursor: '', hasMore: false })),
    recognizedVoiceprintPerson: vi.fn(async () => ({
      personRef: 'person-1', identityKind: 'speaker' as const, displayName: '小林', playGranted: false,
      previewAvailable: false, canInvite: true, inviteTargetSelectionRequired: false,
    })),
    recognizedPersonVoiceprints: vi.fn(async () => ({ items: [] })),
    createVoiceprintInvitation: vi.fn(async () => ({ inviteUrl: 'https://example.test/v#t=token', expiresAtMillis: 2 })),
    createRecognizedPersonVoiceprintInvitation: vi.fn(async () => ({ inviteUrl: 'https://example.test/v#t=target', expiresAtMillis: 2 })),
    revokeVoiceprintPlaybackGrant: vi.fn(async () => ({ revoked: true as const })),
    restoreVoiceprintPlayback: vi.fn(async () => ({ canPlay: true, restored: true, updatedAtMillis: 3 })),
  }
}

function tool(name: string, ports: ArkmeVoiceprintToolPort) {
  const module = voiceprintToolModules.find(item => item.meta.toolName === name)
  if (module === undefined || module.meta.phase !== 'core') throw new Error(`missing ${name}`)
  return module.create(ports as never)
}

const exec = { signal: new AbortController().signal } as never

describe('voiceprint business Tools', () => {
  it('registers separate semantic Tools and write ownership', () => {
    expect(voiceprintToolModules.map(module => [module.meta.toolName, module.meta.effect])).toEqual([
      ['arkme_voiceprint_status', 'read'],
      ['arkme_voiceprint_grants', 'read'],
      ['arkme_voiceprint_recognized_people', 'read'],
      ['arkme_voiceprint_recognized_person_invite', 'write'],
      ['arkme_voiceprint_invite', 'write'],
      ['arkme_voiceprint_revoke', 'write'],
      ['arkme_voiceprint_restore_playback', 'write'],
    ])
    expect(voiceprintToolModules.filter(module => module.meta.effect === 'write').every(
      module => module.meta.grant === 'explicit-user-write',
    )).toBe(true)
  })

  it('keeps self status and outbound grants on different ports', async () => {
    const ports = fixture()
    await tool('arkme_voiceprint_status', ports).execute({}, exec)
    await tool('arkme_voiceprint_grants', ports).execute({ cursor: '', limit: 20 }, exec)

    expect(ports.myVoiceprint).toHaveBeenCalledOnce()
    expect(ports.outboundVoiceprintGrants).toHaveBeenCalledWith(
      { cursor: '', limit: 20 }, { signal: expect.any(AbortSignal) },
    )
    expect(ports.recognizedVoiceprintPeople).not.toHaveBeenCalled()
  })

  it('routes recognized list, detail, and voiceprint library without accepting grant refs', async () => {
    const ports = fixture()
    const definition = tool('arkme_voiceprint_recognized_people', ports)
    await definition.execute({ operation: 'list', cursor: '', limit: 20 }, exec)
    await definition.execute({ operation: 'detail', person_ref: 'arkme-voiceprint-person-v1.opaque' }, exec)
    await definition.execute({ operation: 'voiceprints', person_ref: 'arkme-voiceprint-person-v1.opaque' }, exec)
    await expect(definition.execute({ operation: 'detail', person_ref: 'arkme-voiceprint-grant-v1.opaque' }, exec))
      .rejects.toThrow('person_ref')

    expect(ports.recognizedVoiceprintPeople).toHaveBeenCalledWith(
      { cursor: '', limit: 20 }, { signal: expect.any(AbortSignal) },
    )
    expect(ports.recognizedVoiceprintPerson).toHaveBeenCalledWith(
      'arkme-voiceprint-person-v1.opaque', { signal: expect.any(AbortSignal) },
    )
    expect(ports.recognizedPersonVoiceprints).toHaveBeenCalledWith(
      'arkme-voiceprint-person-v1.opaque', { signal: expect.any(AbortSignal) },
    )
  })

  it('delegates general invite, targeted recognized-person invite, revoke, and restore as independent writes', async () => {
    const ports = fixture()
    await tool('arkme_voiceprint_invite', ports).execute({}, exec)
    await tool('arkme_voiceprint_recognized_person_invite', ports).execute({
      person_ref: 'arkme-voiceprint-person-v1.opaque', target_contact_ref: 'arkme-contact-v1.opaque',
    }, exec)
    await tool('arkme_voiceprint_revoke', ports).execute({ grant_ref: 'arkme-voiceprint-grant-v1.opaque' }, exec)
    await tool('arkme_voiceprint_restore_playback', ports).execute({}, exec)

    expect(ports.createVoiceprintInvitation).toHaveBeenCalledOnce()
    expect(ports.createRecognizedPersonVoiceprintInvitation).toHaveBeenCalledWith(
      'arkme-voiceprint-person-v1.opaque', 'arkme-contact-v1.opaque', { signal: expect.any(AbortSignal) },
    )
    expect(ports.revokeVoiceprintPlaybackGrant).toHaveBeenCalledWith(
      'arkme-voiceprint-grant-v1.opaque', { signal: expect.any(AbortSignal) },
    )
    expect(ports.restoreVoiceprintPlayback).toHaveBeenCalledOnce()
  })

  it('does not require a contact reference for an already bound recognized person', async () => {
    const ports = fixture()
    await tool('arkme_voiceprint_recognized_person_invite', ports).execute({
      person_ref: 'arkme-voiceprint-person-v1.opaque',
    }, exec)

    expect(ports.createRecognizedPersonVoiceprintInvitation).toHaveBeenCalledWith(
      'arkme-voiceprint-person-v1.opaque', undefined, { signal: expect.any(AbortSignal) },
    )
  })
})
