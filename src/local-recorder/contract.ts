export interface LocalRecorderStorage {
  status: 'ready' | 'unformatted' | 'unavailable'
  totalBytes: number
  usedBytes: number
  remainingBytes: number
  remainingSeconds: number
  generation: number
  physicalBytes?: number
  audioRemainingBytes?: number
}
export interface LocalRecorderRecording {
  id: string
  sessionId: number
  startAtMillis: number | null
  durationMillis: number
  complete: boolean
  cached: boolean
  /** Optional for indexes created by older clients. Values describe verified cached pages. */
  info?: {
    audioBytes: number; cachedDurationMillis: number; endAtMillis: number | null
    batteryStartMV: number | null; batteryEndMV: number | null; firmwareVersion: number | null
    gainStartDb: number | null; gainChanges: number; vadEnabled: boolean | null; vadThreshold: number | null
    stopReason: number | null; blockCount: number; crcVerified: boolean
  }
}
export interface LocalRecorderTransfer {
  phase: 'checking' | 'reading' | 'indexing' | 'completed' | 'stopped' | 'failed'
  startedAtMillis: number; elapsedMillis: number; readMillis: number; readBytes: number
  scannedBlocks: number; totalBlocks: number | null
}
export interface LocalRecorderDevice {
  id: string
  name: string
  serialNumber: string | null
  connected: boolean
  storage: LocalRecorderStorage | null
  recordings: LocalRecorderRecording[]
  recordingCount: number
  updatedAtMillis: number
  job: { state: 'syncing' | 'completed' | 'stopped' | 'failed'; blocks: number; detail: string; transfer?: LocalRecorderTransfer } | null
}
export interface LocalRecorderSnapshot {
  supported: boolean
  reason?: string
  devices: LocalRecorderDevice[]
}
export interface LocalRecorderAudio {
  ref: string
  fileName: string
  durationMillis: number
  size: number
}
export interface LocalRecorderRecordingPage { items: LocalRecorderRecording[]; total: number; revision: number }
export type LocalRecorderOperation =
  | 'recorders.local.snapshot' | 'recorders.local.discover' | 'recorders.local.sync'
  | 'recorders.local.stop' | 'recorders.local.prepare' | 'recorders.local.import' | 'recorders.local.recordings'
