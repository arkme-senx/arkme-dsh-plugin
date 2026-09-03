import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalRecordingImportSource, probeRecordingImportFile } from '../src/recording-import-probe.js'
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
