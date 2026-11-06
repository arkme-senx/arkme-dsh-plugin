export interface LocalRecorderStorage {
  status: 'ready' | 'unformatted' | 'unavailable'
  totalBytes: number
  usedBytes: number
  remainingBytes: number
  remainingSeconds: number
  generation: number
}
export interface LocalRecorderRecording {
  id: string
  sessionId: number
  startAtMillis: number | null
  durationMillis: number
  complete: boolean
  cached: boolean
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
  job: { state: 'syncing' | 'completed' | 'stopped' | 'failed'; blocks: number; detail: string } | null
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
