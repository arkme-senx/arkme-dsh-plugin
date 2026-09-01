import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalRecordingImportSource, probeRecordingImportFile } from '../src/recording-import-probe.js'

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
