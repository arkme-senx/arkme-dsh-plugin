export const RECORDING_MINIMUM_YEAR = 1970

export function recordingMinimumLocalDateMillis(): number {
  return new Date(RECORDING_MINIMUM_YEAR, 0, 1).getTime()
}

export function isRecordingLocalDateOnOrAfterMinimum(value: number): boolean {
  return Number.isSafeInteger(value) && value >= recordingMinimumLocalDateMillis()
}

export function isRecordingInstantOnOrAfterUnixEpoch(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}
