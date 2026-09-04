import { open, unlink } from 'node:fs/promises'
import { CustomSource, Input, MP3, MP4, WAVE } from 'mediabunny'
import {
  RecordingImportContractError,
  recordingImportFileKind,
  type RecordingImportFileKind,
  type RecordingImportSource,
} from './recording-import-contract.js'
import { probeImaAdpcmWave, type RecordingByteSource } from './recording-wave-probe.js'

// Ten-hour AAC sample-size and per-packet 64-bit offset tables at 192 kHz use about 78 MiB.
// Leave headroom while bounding each allocation requested by an untrusted container header.
const MAX_RECORDING_PROBE_READ_BYTES = 128 * 1024 * 1024

export interface RecordingImportProbe {
  kind: RecordingImportFileKind
  durationMillis: number
}

export async function probeRecordingImportFile(
  filePath: string,
  metadata: { fileName: string; mimeType: string; fileSize: number },
): Promise<RecordingImportProbe> {
  const handle = await open(filePath, 'r')
  try {
    return await probeRecordingImportSource({
      size: (await handle.stat()).size,
      read: async (offset, length) => {
        const bytes = new Uint8Array(length)
        const { bytesRead } = await handle.read(bytes, 0, length, offset)
        return bytes.subarray(0, bytesRead)
      },
    }, metadata)
  } finally {
    await handle.close()
  }
}

export async function probeRecordingImportSource(
  source: RecordingByteSource,
  metadata: { fileName: string; mimeType: string; fileSize: number },
): Promise<RecordingImportProbe> {
  if (source.size !== metadata.fileSize) {
    throw new RecordingImportContractError('recording-import-size-mismatch', '录音文件大小与声明不一致')
  }
  const boundedSource: RecordingByteSource = {
    size: source.size,
    read: (offset, length) => {
      if (length > MAX_RECORDING_PROBE_READ_BYTES) {
        throw new RecordingImportContractError('recording-import-probe-failed', '录音元数据过大，无法安全校验')
      }
      return source.read(offset, length)
    },
  }

  let input: Input | undefined
  try {
    const imaAdpcm = await probeImaAdpcmWave(boundedSource)
    if (imaAdpcm !== undefined) {
      const declaredKind = recordingImportFileKind({ ...metadata, durationMillis: imaAdpcm.durationMillis })
      if (declaredKind !== 'wav') {
        throw new RecordingImportContractError('recording-import-format-mismatch', '录音格式与文件内容不一致')
      }
      return { kind: 'wav', durationMillis: imaAdpcm.durationMillis }
    }

    input = new Input({ source: new CustomSource({
      getSize: () => boundedSource.size,
      read: (start, end) => boundedSource.read(start, end - start),
      prefetchProfile: 'fileSystem',
    }), formats: [WAVE, MP3, MP4] })
    if (!await input.canRead()) {
      throw new RecordingImportContractError('recording-import-format-invalid', '无法识别录音文件内容')
    }
    const actualFormat = await input.getFormat()
    const actualKind: RecordingImportFileKind | undefined = actualFormat === WAVE
      ? 'wav'
      : actualFormat === MP3
        ? 'mp3'
        : actualFormat === MP4
          ? 'm4a'
          : undefined
    if (actualKind === undefined) {
      throw new RecordingImportContractError('recording-import-format-unsupported', '仅支持 WAV、MP3 和 M4A 录音')
    }
    const tracks = await input.getTracks()
    const audioTracks = await input.getAudioTracks()
    if (audioTracks.length === 0 || tracks.some(track => track.type !== 'audio')) {
      throw new RecordingImportContractError('recording-import-audio-invalid', '文件必须包含纯音频内容')
    }
    const durationSeconds = await input.getDurationFromMetadata(audioTracks)
      ?? await input.computeDuration(audioTracks)
    const durationMillis = Math.round(durationSeconds * 1000)
    const declaredKind = recordingImportFileKind({ ...metadata, durationMillis })
    if (actualKind !== declaredKind) {
      throw new RecordingImportContractError('recording-import-format-mismatch', '录音格式与文件内容不一致')
    }
    return { kind: actualKind, durationMillis }
  } catch (error) {
    if (error instanceof RecordingImportContractError) throw error
    throw new RecordingImportContractError('recording-import-probe-failed', '录音文件校验失败')
  } finally {
    input?.dispose()
  }
}

export class LocalRecordingImportSource implements RecordingImportSource {
  async inspect(
    sourceHandle: string,
    metadata: { fileName: string; mimeType: string; fileSize: number },
  ): Promise<RecordingImportProbe> {
    return await probeRecordingImportFile(sourceHandle, metadata)
  }

  async discard(sourceHandle: string): Promise<void> {
    await unlink(sourceHandle).catch(() => undefined)
  }
}
