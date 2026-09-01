const RECORDING_SPEAKER_PALETTE = [
  '#ec7fa9', '#799eff', '#80a1ba', '#b4debd', '#f5d2d2',
  '#ffde63', '#e69db8', '#b7b1f2', '#91c4c3', '#4cc9fe',
  '#ffbd73', '#e178c5', '#beadfa', '#ffa1cf', '#e6ba95',
] as const

export function recordingSpeakerColor(index: number): string {
  if (index < 0) return '#a4a4a4'
  if (index < RECORDING_SPEAKER_PALETTE.length) return RECORDING_SPEAKER_PALETTE[index] ?? '#a4a4a4'
  const cycleStart = Math.max(0, RECORDING_SPEAKER_PALETTE.length - 7)
  const cycleLength = RECORDING_SPEAKER_PALETTE.length - cycleStart
  return cycleLength > 0
    ? RECORDING_SPEAKER_PALETTE[cycleStart + ((index - cycleStart + 1) % cycleLength)] ?? '#a4a4a4'
    : '#a4a4a4'
}
