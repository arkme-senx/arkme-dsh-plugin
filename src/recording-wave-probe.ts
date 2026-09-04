export interface RecordingByteSource {
  readonly size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export interface ImaAdpcmWaveProbe {
  durationMillis: number
}

const MAX_WAVE_CHUNK_COUNT = 1_024

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

async function readExact(source: RecordingByteSource, offset: number, length: number): Promise<Uint8Array> {
  const bytes = await source.read(offset, length)
  if (bytes.byteLength !== length) throw new TypeError('WAV 文件内容不完整')
  return bytes
}

export async function probeImaAdpcmWave(
  source: RecordingByteSource,
): Promise<ImaAdpcmWaveProbe | undefined> {
  if (!Number.isSafeInteger(source.size) || source.size < 12) return undefined
  const header = await readExact(source, 0, 12)
  if (ascii(header, 0, 4) !== 'RIFF' || ascii(header, 8, 4) !== 'WAVE') return undefined

  const riffEnd = uint32(header, 4) + 8
  if (riffEnd < 12 || riffEnd > source.size) throw new TypeError('WAV RIFF 长度无效')

  let offset = 12
  let format: {
    channels: number
    sampleRate: number
    blockAlign: number
    bitsPerSample: number
    samplesPerBlock: number
  } | undefined
  let dataSize: number | undefined
  let chunkCount = 0

  while (offset + 8 <= riffEnd) {
    chunkCount += 1
    if (chunkCount > MAX_WAVE_CHUNK_COUNT) throw new TypeError('WAV chunk 数量过多')
    const chunkHeader = await readExact(source, offset, 8)
    const chunkId = ascii(chunkHeader, 0, 4)
    const chunkSize = uint32(chunkHeader, 4)
    const chunkOffset = offset + 8
    const nextOffset = chunkOffset + chunkSize + (chunkSize % 2)
    if (!Number.isSafeInteger(nextOffset) || nextOffset > riffEnd) throw new TypeError('WAV chunk 长度无效')

    if (chunkId === 'fmt ') {
      if (chunkSize < 2) throw new TypeError('WAV fmt chunk 无效')
      const bytes = await readExact(source, chunkOffset, Math.min(chunkSize, 20))
      if (uint16(bytes, 0) !== 0x0011) return undefined
      if (bytes.byteLength < 20 || uint16(bytes, 16) < 2) throw new TypeError('IMA ADPCM fmt chunk 无效')
      format = {
        channels: uint16(bytes, 2),
        sampleRate: uint32(bytes, 4),
        blockAlign: uint16(bytes, 12),
        bitsPerSample: uint16(bytes, 14),
        samplesPerBlock: uint16(bytes, 18),
      }
    } else if (chunkId === 'data') {
      dataSize = chunkSize
    }

    if (format !== undefined && dataSize !== undefined) break
    offset = nextOffset
  }

  if (format === undefined) throw new TypeError('IMA ADPCM WAV 缺少 fmt chunk')
  if (dataSize === undefined || dataSize <= 0) throw new TypeError('IMA ADPCM WAV 缺少音频数据')
  const { channels, sampleRate, blockAlign, bitsPerSample, samplesPerBlock } = format
  if (channels <= 0 || sampleRate <= 0 || bitsPerSample !== 4) {
    throw new TypeError('IMA ADPCM WAV 编码参数无效')
  }
  const blockHeaderSize = channels * 4
  const encodedGroupSize = channels * 4
  const blockPayloadSize = blockAlign - blockHeaderSize
  if (blockPayloadSize < 0 || blockPayloadSize % encodedGroupSize !== 0) {
    throw new TypeError('IMA ADPCM WAV 编码参数无效')
  }
  const expectedSamplesPerBlock = 1 + blockPayloadSize / encodedGroupSize * 8
  if (samplesPerBlock <= 0 || samplesPerBlock !== expectedSamplesPerBlock) {
    throw new TypeError('IMA ADPCM WAV 编码参数无效')
  }

  const completeBlocks = Math.floor(dataSize / blockAlign)
  const remainder = dataSize % blockAlign
  if (remainder !== 0
    && (remainder < blockHeaderSize || (remainder - blockHeaderSize) % encodedGroupSize !== 0)) {
    throw new TypeError('IMA ADPCM WAV 音频数据无效')
  }
  const partialBlockSamples = remainder === 0
    ? 0
    : 1 + (remainder - blockHeaderSize) / encodedGroupSize * 8
  const totalSamples = completeBlocks * samplesPerBlock + partialBlockSamples
  const durationMillis = Math.round(totalSamples * 1_000 / sampleRate)
  if (!Number.isSafeInteger(durationMillis) || durationMillis <= 0) {
    throw new TypeError('IMA ADPCM WAV 时长无效')
  }
  return { durationMillis }
}
