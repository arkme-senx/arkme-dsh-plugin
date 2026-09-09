import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, Output } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import { LocalRecordingImportSource, probeRecordingImportFile, probeRecordingImportSource } from '../src/recording-import-probe.js'
import { probeImaAdpcmWave } from '../src/recording-wave-probe.js'
import { desktopRecorderImaAdpcmMonoWav } from './recording-import-ima-adpcm-fixture.js'

function oneSecondMonoWav(): Buffer {
  const sampleRate = 8_000
  const sampleBytes = 2
  const dataSize = sampleRate * sampleBytes
  const bytes = Buffer.alloc(44 + dataSize)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + dataSize, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * sampleBytes, 28)
  bytes.writeUInt16LE(sampleBytes, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(dataSize, 40)
  return bytes
}

describe('recording import file probe', () => {
  it('rejects an oversized M4A metadata read before the source can allocate its declared box', async () => {
    const size = 1024 * 1024 * 1024
    const header = Buffer.alloc(32)
    header.writeUInt32BE(24, 0)
    header.write('ftyp', 4)
    header.write('M4A ', 8)
    header.write('isomM4A ', 16)
    header.writeUInt32BE(size - 24, 24)
    header.write('moov', 28)
    const reads: number[] = []

    await expect(probeRecordingImportSource({ size, read: async (offset, length) => {
      reads.push(length)
      // Keep the regression safe on the unpatched implementation too.
      if (length > 128 * 1024 * 1024) throw new Error('Source would allocate nearly 1 GiB')
      const bytes = new Uint8Array(length)
      if (offset < header.length) bytes.set(header.subarray(offset, Math.min(offset + length, header.length)))
      return bytes
    } }, { fileName: 'broken.m4a', mimeType: 'audio/mp4', fileSize: size }))
      .rejects.toMatchObject({ code: 'recording-import-probe-failed' })
    expect(Math.max(...reads)).toBeLessThanOrEqual(128 * 1024 * 1024)
  })

  it.each([1, 10])('reads bounded PCM metadata for %i hours without scanning audio data', async hours => {
    const header = oneSecondMonoWav().subarray(0, 44)
    const size = 44 + 16_000 * 3600 * hours
    header.writeUInt32LE(size - 8, 4)
    header.writeUInt32LE(size - 44, 40)
    let readBytes = 0
    const result = await probeRecordingImportSource({ size, read: async (offset, length) => {
      readBytes += length
      const bytes = new Uint8Array(length)
      if (offset < header.length) bytes.set(header.subarray(offset, Math.min(offset + length, header.length)))
      return bytes
    } }, { fileName: 'hour.wav', mimeType: 'audio/wav', fileSize: size })
    expect(result.durationMillis).toBe(3_600_000 * hours)
    expect(readBytes).toBeLessThan(256 * 1024)
  })

  it('accepts ten-hour CBR MP3 metadata without scanning its 576 MB payload', async () => {
    const size = 576_000_000 // 128 kbit/s, 48 kHz, 384-byte frames over ten hours.
    let readBytes = 0
    const result = await probeRecordingImportSource({ size, read: async (offset, length) => {
      readBytes += length
      const bytes = new Uint8Array(length)
      const frameHeader = new Uint8Array([0xff, 0xfb, 0x94, 0])
      for (let frame = Math.floor(offset / 384) * 384; frame < offset + length; frame += 384) {
        for (let index = 0; index < frameHeader.length; index++) {
          if (frame + index >= offset && frame + index < offset + length) bytes[frame + index - offset] = frameHeader[index]!
        }
      }
      return bytes
    } }, { fileName: 'ten-hours.mp3', mimeType: 'audio/mpeg', fileSize: size })
    expect(result).toEqual({ kind: 'mp3', durationMillis: 36_000_000 })
    expect(readBytes).toBeLessThan(256 * 1024)
  })

  it('accepts a ten-hour M4A timeline with 32 MiB metadata padding in a 1 GiB container', async () => {
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new BufferTarget() })
    const audio = new EncodedAudioPacketSource('aac')
    output.addAudioTrack(audio)
    await output.start()
    const duration = 1024 / 48000
    const silence = new Uint8Array([0, 208, 0, 7])
    await audio.add(new EncodedPacket(silence, 'key', 0, duration), {
      decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: 1, sampleRate: 48000, description: new Uint8Array([0x11, 0x88]) },
    })
    await audio.add(new EncodedPacket(silence, 'key', 36000 - duration, duration))
    audio.close()
    await output.finalize()
    const header = Buffer.from(output.target.buffer!)
    let moov = 0
    while (header.toString('ascii', moov + 4, moov + 8) !== 'moov') {
      const boxSize = header.readUInt32BE(moov)
      moov += boxSize === 1 ? Number(header.readBigUInt64BE(moov + 8)) : boxSize
    }
    expect(moov + header.readUInt32BE(moov)).toBe(header.length)
    const padding = 32 * 1024 * 1024
    header.writeUInt32BE(header.readUInt32BE(moov) + padding, moov)
    const free = Buffer.alloc(8)
    free.writeUInt32BE(padding, 0)
    free.write('free', 4)
    const size = 1024 * 1024 * 1024
    const tail = Buffer.alloc(8)
    tail.writeUInt32BE(size - header.length - padding, 0)
    tail.write('free', 4)
    let readBytes = 0
    const result = await probeRecordingImportSource({ size, read: async (offset, length) => {
      readBytes += length
      const bytes = new Uint8Array(length)
      for (const [position, content] of [[0, header], [header.length, free], [header.length + padding, tail]] as const) {
        const start = Math.max(offset, position)
        const end = Math.min(offset + length, position + content.length)
        if (start < end) bytes.set(content.subarray(start - position, end - position), start - offset)
      }
      return bytes
    } }, { fileName: 'ten-hours.m4a', mimeType: 'audio/mp4', fileSize: size })
    expect(result).toEqual({ kind: 'm4a', durationMillis: 36_000_000 })
    expect(readBytes).toBeLessThan(34 * 1024 * 1024)
  })

  it('reads the actual audio container and duration from the Host file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-probe-'))
    const path = join(root, 'voice.upload')
    await writeFile(path, oneSecondMonoWav())

    await expect(probeRecordingImportFile(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: 16_044,
    })).resolves.toMatchObject({ kind: 'wav', durationMillis: 1_000 })
  })

  it('rejects a file whose actual container disagrees with its name and MIME', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-probe-'))
    const path = join(root, 'disguised.upload')
    await writeFile(path, oneSecondMonoWav())

    await expect(probeRecordingImportFile(path, {
      fileName: 'disguised.mp3', mimeType: 'audio/mpeg', fileSize: 16_044,
    })).rejects.toThrow(/格式与文件内容不一致/)
  })

  it('accepts a desktop IMA ADPCM WAV through the Host probe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-probe-'))
    const path = join(root, 'desktop-recording.upload')
    const wav = desktopRecorderImaAdpcmMonoWav()
    await writeFile(path, wav)

    await expect(probeRecordingImportFile(path, {
      fileName: 'R20260826-014759.WAV', mimeType: 'audio/wav', fileSize: wav.byteLength,
    })).resolves.toEqual({ kind: 'wav', durationMillis: 1_010 })
  })

  it('rejects malformed IMA ADPCM block metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-probe-'))
    const path = join(root, 'malformed.upload')
    const wav = desktopRecorderImaAdpcmMonoWav()
    new DataView(wav.buffer).setUint16(38, 504, true)
    await writeFile(path, wav)

    await expect(probeRecordingImportFile(path, {
      fileName: 'malformed.wav', mimeType: 'audio/wav', fileSize: wav.byteLength,
    })).rejects.toThrow('录音文件校验失败')
  })

  it('rejects an IMA ADPCM block alignment that splits an encoded channel group', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-probe-'))
    const path = join(root, 'misaligned.upload')
    const wav = desktopRecorderImaAdpcmMonoWav()
    const view = new DataView(wav.buffer)
    view.setUint16(32, 257, true)
    view.setUint16(38, 507, true)
    await writeFile(path, wav)

    await expect(probeRecordingImportFile(path, {
      fileName: 'misaligned.wav', mimeType: 'audio/wav', fileSize: wav.byteLength,
    })).rejects.toThrow('录音文件校验失败')
  })

  it('keeps a valid partial final IMA ADPCM block importable', async () => {
    const dataChunkOffset = 504
    const partialDataSize = 256 + 4 + 4
    const original = desktopRecorderImaAdpcmMonoWav()
    const wav = original.slice(0, dataChunkOffset + 8 + partialDataSize)
    const view = new DataView(wav.buffer)
    view.setUint32(4, wav.byteLength - 8, true)
    view.setUint32(dataChunkOffset + 4, partialDataSize, true)

    await expect(probeImaAdpcmWave({
      size: wav.byteLength,
      read: async (offset, length) => wav.subarray(offset, offset + length),
    })).resolves.toEqual({ durationMillis: 11 })
  })

  it('rejects a partial final IMA ADPCM block with an incomplete encoded group', async () => {
    const dataChunkOffset = 504
    const malformedDataSize = 256 + 4 + 2
    const original = desktopRecorderImaAdpcmMonoWav()
    const wav = original.slice(0, dataChunkOffset + 8 + malformedDataSize)
    const view = new DataView(wav.buffer)
    view.setUint32(4, wav.byteLength - 8, true)
    view.setUint32(dataChunkOffset + 4, malformedDataSize, true)

    await expect(probeImaAdpcmWave({
      size: wav.byteLength,
      read: async (offset, length) => wav.subarray(offset, offset + length),
    })).rejects.toThrow('IMA ADPCM WAV 音频数据无效')
  })

  it('bounds malformed RIFF chunk traversal before it can block an import', async () => {
    const chunkCount = 1_025
    const bytes = new Uint8Array(12 + chunkCount * 8)
    const view = new DataView(bytes.buffer)
    const encoder = new TextEncoder()
    bytes.set(encoder.encode('RIFF'), 0)
    view.setUint32(4, bytes.byteLength - 8, true)
    bytes.set(encoder.encode('WAVE'), 8)
    const junk = encoder.encode('JUNK')
    for (let index = 0; index < chunkCount; index += 1) {
      bytes.set(junk, 12 + index * 8)
    }

    await expect(probeImaAdpcmWave({
      size: bytes.byteLength,
      read: async (offset, length) => bytes.subarray(offset, offset + length),
    })).rejects.toThrow('WAV chunk 数量过多')
  })

  it('encapsulates inspection and cleanup behind the local import source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-source-'))
    const path = join(root, 'voice.upload')
    await writeFile(path, oneSecondMonoWav())
    const source = new LocalRecordingImportSource()

    await expect(source.inspect(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: 16_044,
    })).resolves.toEqual({ kind: 'wav', durationMillis: 1_000 })
    await source.discard(path)
    await expect(access(path)).rejects.toThrow()
  })
})
