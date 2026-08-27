import { describe, expect, it } from 'vitest'
import { validateVoiceprintPcm16Wav } from '../src/voiceprint-wav.js'
import { encodeMonoPcm16Wav } from '../src/client/voiceprint-recorder.js'

describe('voiceprint WAV contract', () => {
  it('accepts mono PCM16 and derives a duration consistent with the declared value', () => {
    const wav = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)
    expect(validateVoiceprintPcm16Wav(wav, 3_000)).toEqual({ sampleRate: 8_000, durationMs: 3_000 })
  })

  it('rejects truncated headers and inconsistent duration declarations', () => {
    const wav = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)
    expect(() => validateVoiceprintPcm16Wav(wav.subarray(0, 44), 3_000)).toThrow(TypeError)
    expect(() => validateVoiceprintPcm16Wav(wav, 4_000)).toThrow(TypeError)
  })

  it('rejects non-PCM, stereo, invalid-rate and inconsistent canonical headers', () => {
    const source = encodeMonoPcm16Wav([new Float32Array(24_000)], 8_000)
    const invalidFields: Array<[number, number, 'u16' | 'u32']> = [
      [20, 3, 'u16'],
      [22, 2, 'u16'],
      [24, 7_999, 'u32'],
      [28, 1, 'u32'],
      [32, 4, 'u16'],
      [34, 24, 'u16'],
      [40, 2, 'u32'],
    ]
    for (const [offset, value, kind] of invalidFields) {
      const wav = new Uint8Array(source)
      const view = new DataView(wav.buffer)
      if (kind === 'u16') view.setUint16(offset, value, true)
      else view.setUint32(offset, value, true)
      expect(() => validateVoiceprintPcm16Wav(wav, 3_000)).toThrow(TypeError)
    }
  })
})
