import { describe, expect, it, vi } from 'vitest'
import { SameOriginArkmeVoiceprintEnrollmentClient } from '../../src/client/voiceprint-enrollment-client.js'

describe('SameOriginArkmeVoiceprintEnrollmentClient', () => {
  it('owns the same-origin WAV transport contract behind the enrollment interface', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: { status: 'processing', cloneReady: true, updatedAtMillis: 123 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    const client = new SameOriginArkmeVoiceprintEnrollmentClient(fetchImpl)
    const signal = new AbortController().signal
    const wav = Uint8Array.from([82, 73, 70, 70])

    await expect(client.enroll('/arkme-self/api/voiceprint/enroll', {
      wav, durationMs: 3_000,
    }, signal)).resolves.toEqual({ status: 'processing', cloneReady: true, updatedAtMillis: 123 })

    expect(fetchImpl).toHaveBeenCalledWith('/arkme-self/api/voiceprint/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Arkme-Duration-Ms': '3000' },
      body: wav.buffer,
      signal,
    })
  })

  it('preserves the route error without creating a client retry state', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: 'account-changed', message: '登录账号已切换' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    const client = new SameOriginArkmeVoiceprintEnrollmentClient(fetchImpl)

    await expect(client.enroll('/arkme-self/api/voiceprint/enroll', {
      wav: Uint8Array.from([82, 73, 70, 70]),
      durationMs: 3_000,
    })).rejects.toThrow('登录账号已切换')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
