import { describe, expect, it } from 'vitest'
import { encodeMonoPcm16Wav } from '../src/client/voiceprint-recorder.js'

describe('voiceprint WAV encoder', () => {
  it('encodes mono float samples as bounded PCM16 WAV bytes', () => {
    const wav = encodeMonoPcm16Wav([new Float32Array([-2, -1, 0, 0.5, 1, 2])], 16_000)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(12)
    expect(Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([
      -32768, -32768, 0, 16384, 32767, 32767,
    ])
  })

  it('rejects invalid sample rates instead of creating malformed audio', () => {
    expect(() => encodeMonoPcm16Wav([], 0)).toThrow(TypeError)
  })
})
