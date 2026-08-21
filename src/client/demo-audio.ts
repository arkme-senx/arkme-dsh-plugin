export function createDemoWavUrl(durationSeconds: number): string {
  const safeDuration = Math.max(1, Math.min(60, durationSeconds))
  const sampleRate = 8_000
  const sampleCount = Math.floor(sampleRate * safeDuration)
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate
    const carrier = Math.floor(time / 1.4) % 2 === 0 ? 176 : 220
    const envelope = Math.max(0, Math.sin((time % 1.4) / 1.4 * Math.PI))
    const value = Math.sin(2 * Math.PI * carrier * time) * .08 * envelope
      + Math.sin(2 * Math.PI * (carrier * 1.51) * time) * .035 * envelope
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true)
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}
