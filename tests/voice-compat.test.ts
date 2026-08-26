import { afterEach, describe, expect, it, vi } from 'vitest'
import { BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny'
import { loadCompatibleVoice, repairVoiceAac } from '../src/client/arkme-voice-compat.js'
import { silencePacket, syntheticAac } from './fixtures/voice-parity/aac.js'

const signal = () => new AbortController().signal
afterEach(() => { vi.unstubAllGlobals() })

describe('AAC configuration sample compatibility', () => {
  it('drops only the leading codec config, preserving all encoded audio bytes and timing intervals', async () => {
    const bytes = await syntheticAac()
    const original = bytes.slice()
    const repaired = await repairVoiceAac(bytes, signal())
    expect(repaired).toBeDefined()
    expect(bytes).toEqual(original)
    const input = new Input({ formats: [MP4], source: new BufferSource(repaired!) })
    try {
      const track = (await input.getPrimaryAudioTrack())!
      const packets = []
      for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet)
      expect(packets).toHaveLength(86)
      for (const [index, packet] of packets.entries()) {
        expect(packet.data).toEqual(silencePacket)
        expect(packet.timestamp).toBeCloseTo(index * 1024 / 44100, 5)
      }
      expect(await repairVoiceAac(new Uint8Array(repaired!), signal())).toBeUndefined()
    } finally { input.dispose() }
  })

  it('does not blindly drop a valid first frame or an unrelated short/corrupt frame', async () => {
    for (const prefix of [silencePacket, new Uint8Array([1, 2])]) {
      expect(await repairVoiceAac(await syntheticAac(prefix), signal())).toBeUndefined()
    }
    expect(await repairVoiceAac(await syntheticAac(new Uint8Array([18, 8]), 0), signal())).toBeUndefined()
    await expect(repairVoiceAac(new Uint8Array([1, 2, 3]), signal())).rejects.toThrow()
  })

  it('honors abort and size bounds before parsing', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(repairVoiceAac(new Uint8Array(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(repairVoiceAac(new Uint8Array(16 * 1024 * 1024 + 1), signal())).rejects.toThrow('size limit')
  })

  it('fetches only the existing same-origin media endpoint with the caller signal', async () => {
    vi.stubGlobal('window', { location: { href: 'https://local.test/', origin: 'https://local.test' } })
    const bytes = await syntheticAac()
    const fetch = vi.fn(async () => new Response(bytes as BodyInit, { headers: { 'content-type': 'audio/mp4' } }))
    vi.stubGlobal('fetch', fetch)
    const current = signal()
    const blob = await loadCompatibleVoice('/arkme-self/api/media?ref=opaque', current)
    expect(blob.type).toBe('audio/mp4')
    expect(fetch).toHaveBeenCalledWith('https://local.test/arkme-self/api/media?ref=opaque', { signal: current, credentials: 'same-origin', redirect: 'error' })
    await expect(loadCompatibleVoice('https://remote.test/audio', current)).rejects.toThrow('source')
    await expect(loadCompatibleVoice('/unrelated', current)).rejects.toThrow('source')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('fails on HTTP errors and cancels oversized streams without buffering the whole response', async () => {
    vi.stubGlobal('window', { location: { href: 'https://local.test/', origin: 'https://local.test' } })
    const cancel = vi.fn()
    const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(new Response(oversized)))
    await expect(loadCompatibleVoice('/arkme-self/api/media', signal())).rejects.toThrow('unavailable')
    await expect(loadCompatibleVoice('/arkme-self/api/media', signal())).rejects.toThrow('size limit')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
