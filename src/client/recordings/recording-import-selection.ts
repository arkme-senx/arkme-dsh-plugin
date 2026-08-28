import { BlobSource, Input, MP3, MP4, WAVE } from 'mediabunny'

const MAX_RECORDING_IMPORT_BYTES = 1024 ** 3
const MAX_RECORDING_IMPORT_DURATION_MILLIS = 10 * 60 * 60 * 1_000

export type ArkmeRecordingSelectionFormat = 'WAV' | 'MP3' | 'M4A'

export type ArkmeRecordingSelection =
  | { ok: true; format: ArkmeRecordingSelectionFormat; durationMillis?: number }
  | { ok: false; message: string }

export interface ArkmeRecordingSelectionProbe {
  format: ArkmeRecordingSelectionFormat
  durationMillis: number
}

export interface ArkmeRecordingSelectionDependencies {
  probe(file: File): Promise<ArkmeRecordingSelectionProbe>
}

function declaredFormat(fileName: string): ArkmeRecordingSelectionFormat | undefined {
  const extension = fileName.trim().toLowerCase().match(/\.([^.]+)$/)?.[1]
  return extension === 'wav' ? 'WAV' : extension === 'mp3' ? 'MP3' : extension === 'm4a' ? 'M4A' : undefined
}

export function validateArkmeRecordingSelection(file: File): ArkmeRecordingSelection {
  const format = declaredFormat(file.name)
  if (format === undefined) return { ok: false, message: '仅支持 WAV、MP3 和 M4A 录音' }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return { ok: false, message: '录音文件不能为空' }
  if (file.size > MAX_RECORDING_IMPORT_BYTES) return { ok: false, message: '录音文件不能超过 1 GiB' }
  return { ok: true, format }
}

async function probeRecordingFile(file: File): Promise<ArkmeRecordingSelectionProbe> {
  const input = new Input({ source: new BlobSource(file), formats: [WAVE, MP3, MP4] })
  try {
    if (!await input.canRead()) throw new Error('unreadable')
    const actualFormat = await input.getFormat()
    const format: ArkmeRecordingSelectionFormat | undefined = actualFormat === WAVE
      ? 'WAV'
      : actualFormat === MP3
        ? 'MP3'
        : actualFormat === MP4
          ? 'M4A'
          : undefined
    if (format === undefined) throw new Error('unsupported')
    const tracks = await input.getTracks()
    const audioTracks = await input.getAudioTracks()
    if (audioTracks.length === 0 || tracks.some(track => track.type !== 'audio')) throw new Error('not-audio-only')
    const seconds = await input.getDurationFromMetadata(audioTracks) ?? await input.computeDuration(audioTracks)
    return { format, durationMillis: Math.round(seconds * 1_000) }
  } finally {
    input.dispose()
  }
}

export async function inspectArkmeRecordingSelection(
  file: File,
  dependencies: ArkmeRecordingSelectionDependencies = { probe: probeRecordingFile },
): Promise<ArkmeRecordingSelection> {
  const declared = validateArkmeRecordingSelection(file)
  if (!declared.ok) return declared
  try {
    const probed = await dependencies.probe(file)
    if (probed.format !== declared.format) return { ok: false, message: '录音格式与文件内容不一致' }
    if (!Number.isFinite(probed.durationMillis) || probed.durationMillis <= 0) {
      return { ok: false, message: '录音时长无效' }
    }
    if (probed.durationMillis > MAX_RECORDING_IMPORT_DURATION_MILLIS) {
      return { ok: false, message: '录音时长不能超过 10 小时' }
    }
    return { ok: true, format: probed.format, durationMillis: probed.durationMillis }
  } catch {
    return { ok: false, message: '录音文件校验失败，请确认文件未损坏' }
  }
}
