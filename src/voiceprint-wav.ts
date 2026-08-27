export interface VoiceprintWavMetadata {
  sampleRate: number
  durationMs: number
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

export function validateVoiceprintPcm16Wav(
  wav: Uint8Array,
  declaredDurationMs: number,
): VoiceprintWavMetadata {
  if (wav.byteLength < 46 || !Number.isSafeInteger(declaredDurationMs) || declaredDurationMs <= 0) {
    throw new TypeError('声纹 WAV 元数据无效')
  }
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const sampleRate = view.getUint32(24, true)
  const dataBytes = view.getUint32(40, true)
  const valid = ascii(wav, 0, 4) === 'RIFF'
    && view.getUint32(4, true) === wav.byteLength - 8
    && ascii(wav, 8, 4) === 'WAVE'
    && ascii(wav, 12, 4) === 'fmt '
    && view.getUint32(16, true) === 16
    && view.getUint16(20, true) === 1
    && view.getUint16(22, true) === 1
    && sampleRate >= 8_000 && sampleRate <= 192_000
    && view.getUint32(28, true) === sampleRate * 2
    && view.getUint16(32, true) === 2
    && view.getUint16(34, true) === 16
    && ascii(wav, 36, 4) === 'data'
    && dataBytes > 0
    && dataBytes === wav.byteLength - 44
  if (!valid) throw new TypeError('声纹录音必须是单声道 PCM16 WAV')
  const durationMs = Math.round(dataBytes * 1000 / (sampleRate * 2))
  if (Math.abs(durationMs - declaredDurationMs) > 250) throw new TypeError('声纹 WAV 时长与声明不一致')
  return { sampleRate, durationMs }
}
