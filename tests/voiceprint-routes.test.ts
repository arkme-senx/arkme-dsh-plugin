import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmeVoiceprintEnrollmentHandler } from '../src/voiceprint-routes.js'
import { encodeMonoPcm16Wav } from '../src/client/voiceprint-recorder.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('voiceprint enrollment same-origin route', () => {
  it('accepts one bounded raw WAV and returns only the Browser-safe projection', async () => {
    const wav = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)
    const enrollVoiceprintWav = vi.fn(async () => ({
      status: 'processing' as const, cloneReady: true, updatedAtMillis: 123,
    }))
    const bindVoiceprintEnrollment = vi.fn(async () => ({ enrollVoiceprintWav }))
    let handler: ReturnType<typeof createArkmeVoiceprintEnrollmentHandler>
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${String(address.port)}`
    handler = createArkmeVoiceprintEnrollmentHandler({ bindVoiceprintEnrollment }, {
      expectedPort: address.port, allowNonLoopback: false,
    })

    const response = await fetch(`${origin}/voiceprint/enroll`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'audio/wav', 'X-Arkme-Duration-Ms': '3000' },
      body: wav,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, value: {
      status: 'processing', cloneReady: true, updatedAtMillis: 123,
    } })
    expect(bindVoiceprintEnrollment).toHaveBeenCalledOnce()
    expect(enrollVoiceprintWav).toHaveBeenCalledWith(
      { wav, durationMs: 3000 },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('rejects unsupported media and invalid duration before entering the domain port', async () => {
    const enrollVoiceprintWav = vi.fn()
    let handler: ReturnType<typeof createArkmeVoiceprintEnrollmentHandler>
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${String(address.port)}`
    handler = createArkmeVoiceprintEnrollmentHandler({ bindVoiceprintEnrollment: async () => ({ enrollVoiceprintWav }) }, {
      expectedPort: address.port, allowNonLoopback: false,
    })

    const response = await fetch(`${origin}/voiceprint/enroll`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'audio/webm', 'X-Arkme-Duration-Ms': '1000' },
      body: new Uint8Array([1]),
    })

    expect(response.status).toBe(400)
    expect(enrollVoiceprintWav).not.toHaveBeenCalled()
  })

  it('rejects an untrusted browser origin before reading audio', async () => {
    const enrollVoiceprintWav = vi.fn()
    let handler: ReturnType<typeof createArkmeVoiceprintEnrollmentHandler>
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    handler = createArkmeVoiceprintEnrollmentHandler({ bindVoiceprintEnrollment: async () => ({ enrollVoiceprintWav }) }, {
      expectedPort: address.port, allowNonLoopback: false,
    })

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/voiceprint/enroll`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example', 'Content-Type': 'audio/wav', 'X-Arkme-Duration-Ms': '3000',
      },
      body: encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000),
    })

    expect(response.status).toBe(403)
    expect(enrollVoiceprintWav).not.toHaveBeenCalled()
  })

  it('rejects a missing browser origin before reading audio', async () => {
    const enrollVoiceprintWav = vi.fn()
    let handler: ReturnType<typeof createArkmeVoiceprintEnrollmentHandler>
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${String(address.port)}`
    handler = createArkmeVoiceprintEnrollmentHandler({ bindVoiceprintEnrollment: async () => ({ enrollVoiceprintWav }) }, {
      expectedPort: address.port, allowNonLoopback: false,
    })

    const response = await fetch(`${origin}/voiceprint/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Arkme-Duration-Ms': '3000' },
      body: encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000),
    })

    expect(response.status).toBe(403)
    expect(enrollVoiceprintWav).not.toHaveBeenCalled()
  })

  it('rejects malformed WAV bytes before entering the domain port', async () => {
    const enrollVoiceprintWav = vi.fn()
    let handler: ReturnType<typeof createArkmeVoiceprintEnrollmentHandler>
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test port')
    const origin = `http://127.0.0.1:${String(address.port)}`
    handler = createArkmeVoiceprintEnrollmentHandler({ bindVoiceprintEnrollment: async () => ({ enrollVoiceprintWav }) }, {
      expectedPort: address.port, allowNonLoopback: false,
    })
    const wav = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)
    wav[0] = 0

    const response = await fetch(`${origin}/voiceprint/enroll`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'audio/wav', 'X-Arkme-Duration-Ms': '3000' },
      body: wav,
    })

    expect(response.status).toBe(400)
    expect(enrollVoiceprintWav).not.toHaveBeenCalled()
  })
})
