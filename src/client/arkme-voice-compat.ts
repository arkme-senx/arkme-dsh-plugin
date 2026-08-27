import { BufferSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny'

// Bounded, in-memory playback repair only. Never replace the stored/downloaded file.
const MAX_BYTES = 16 * 1024 * 1024
const MAX_PACKETS = 30_000

/** Some recorders mux AudioSpecificConfig as the first AAC sample. Chromium
 * rejects that sample. Only repair this exact signature, not arbitrary bad AAC.
 * Demux/remux preserves every actual encoded audio packet without transcoding.
 */
export async function repairVoiceAac(bytes: Uint8Array, signal: AbortSignal): Promise<ArrayBuffer | undefined> {
  signal.throwIfAborted()
  if (bytes.byteLength > MAX_BYTES) throw new Error('Voice compatibility size limit')
  const input = new Input({ source: new BufferSource(bytes), formats: [MP4] })
  let output: Output<Mp4OutputFormat, BufferTarget> | undefined
  try {
    const tracks = await input.getTracks()
    const track = await input.getPrimaryAudioTrack()
    if (tracks.length !== 1 || track === null) return undefined
    const config = await track.getDecoderConfig()
    if (config?.codec !== 'mp4a.40.2' || config.description === undefined) return undefined
    const description = config.description
    const asc = ArrayBuffer.isView(description)
      ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
      : new Uint8Array(description)
    if (asc.byteLength !== 2) return undefined
    const sink = new EncodedPacketSink(track)
    const first = await sink.getFirstPacket()
    if (first === null || first.timestamp !== 0 || first.duration <= 0 || first.duration > .05
      || first.data.length !== asc.length || !asc.every((byte, index) => first.data[index] === byte)) return undefined
    const next = await sink.getNextPacket(first)
    if (next === null || next.timestamp <= first.timestamp) return undefined
    signal.throwIfAborted()
    const source = new EncodedAudioPacketSource('aac')
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    output.addAudioTrack(source)
    await output.start()
    let count = 0
    for await (const packet of sink.packets(next)) {
      signal.throwIfAborted()
      if (++count > MAX_PACKETS || packet.timestamp - next.timestamp > 600) throw new Error('Voice compatibility duration limit')
      await source.add(packet.clone({ timestamp: packet.timestamp - next.timestamp }), count === 1 ? { decoderConfig: config } : undefined)
      // Let navigation/preemption abort a longer remux instead of monopolizing UI.
      if (count % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    source.close()
    await output.finalize()
    signal.throwIfAborted()
    return output.target.buffer ?? undefined
  } finally {
    input.dispose()
    if (output !== undefined && output.state !== 'finalized') await output.cancel()
  }
}

export async function loadCompatibleVoice(url: string, signal: AbortSignal): Promise<Blob> {
  // Keep retrieval on the existing, account-scoped media route. No new Host API,
  // credentials, remote signing URLs, or persistent media cache in the browser.
  const target = new URL(url, window.location.href)
  if (target.origin !== window.location.origin || target.pathname !== '/arkme-self/api/media') throw new Error('Unsupported voice compatibility source')
  const response = await fetch(target.href, { signal, credentials: 'same-origin', redirect: 'error' })
  if (!response.ok || response.body === null) throw new Error('Voice compatibility media unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Voice compatibility size limit')
    while (true) {
      signal.throwIfAborted()
      const result = await reader.read()
      if (result.done) break
      length += result.value.length
      if (length > MAX_BYTES) throw new Error('Voice compatibility size limit')
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const repaired = await repairVoiceAac(bytes, signal)
  if (repaired === undefined) throw new Error('Voice compatibility signature not found')
  return new Blob([repaired], { type: 'audio/mp4' })
}
