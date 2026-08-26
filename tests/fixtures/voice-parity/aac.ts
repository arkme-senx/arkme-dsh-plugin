import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, Output } from 'mediabunny'

// One AAC-LC mono 44.1kHz silent frame, generated from all-zero PCM; no user audio.
export const silencePacket = new Uint8Array([0, 208, 0, 7])
export const audioConfig = { codec: 'mp4a.40.2', numberOfChannels: 1, sampleRate: 44100, description: new Uint8Array([18, 8]) }
export async function syntheticAac(prefix: Uint8Array | undefined = audioConfig.description, frames = 86): Promise<Uint8Array> {
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const source = new EncodedAudioPacketSource('aac')
  output.addAudioTrack(source)
  await output.start()
  const duration = 1024 / 44100
  let index = 0
  for (const data of [...(prefix === undefined ? [] : [prefix]), ...Array<Uint8Array>(frames).fill(silencePacket)]) {
    await source.add(new EncodedPacket(data, 'key', index * duration, duration), index++ === 0 ? { decoderConfig: audioConfig } : undefined)
  }
  source.close()
  await output.finalize()
  return new Uint8Array(output.target.buffer!)
}
