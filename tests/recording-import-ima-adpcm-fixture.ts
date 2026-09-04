function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
}

export function desktopRecorderImaAdpcmMonoWav(): Uint8Array {
  const sampleRate = 48_000
  const blockAlign = 256
  const samplesPerBlock = 505
  const blockCount = 96
  const dataSize = blockAlign * blockCount
  const factSize = 456
  const dataChunkOffset = 48 + factSize
  const bytes = new Uint8Array(dataChunkOffset + 8 + dataSize)
  const view = new DataView(bytes.buffer)

  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  view.setUint32(16, 20, true)
  view.setUint16(20, 0x0011, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, Math.floor(sampleRate * blockAlign / samplesPerBlock), true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 4, true)
  view.setUint16(36, 2, true)
  view.setUint16(38, samplesPerBlock, true)
  writeAscii(bytes, 40, 'fact')
  view.setUint32(44, factSize, true)
  view.setUint32(48, blockCount, true)
  writeAscii(bytes, dataChunkOffset, 'data')
  view.setUint32(dataChunkOffset + 4, dataSize, true)

  return bytes
}
