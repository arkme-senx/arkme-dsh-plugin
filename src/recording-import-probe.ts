import { open, stat, unlink } from 'node:fs/promises'
import { FilePathSource, Input, MP3, MP4, WAVE } from 'mediabunny'
import {
  RecordingImportContractError,
  recordingImportFileKind,
  type RecordingImportFileKind,
  type RecordingImportSource,
} from './recording-import-contract.js'
import { probeImaAdpcmWave } from './recording-wave-probe.js'

export interface RecordingImportProbe {
  kind: RecordingImportFileKind
  durationMillis: number
}

export async function probeRecordingImportFile(
  filePath: string,
  metadata: { fileName: string; mimeType: string; fileSize: number },
): Promise<RecordingImportProbe> {
  const actualSize = (await stat(filePath)).size
  if (actualSize !== metadata.fileSize) {
    throw new RecordingImportContractError('recording-import-size-mismatch', '录音文件大小与声明不一致')
  }

  let input: Input | undefined
  try {
    const handle = await open(filePath, 'r')
    let imaAdpcm
    try {
      imaAdpcm = await probeImaAdpcmWave({
        size: actualSize,
        read: async (offset, length) => {
          const bytes = new Uint8Array(length)
          const { bytesRead } = await handle.read(bytes, 0, length, offset)
          return bytes.subarray(0, bytesRead)
        },
      })
    } finally {
      await handle.close()
    }
    if (imaAdpcm !== undefined) {
      const declaredKind = recordingImportFileKind({ ...metadata, durationMillis: imaAdpcm.durationMillis })
      if (declaredKind !== 'wav') {
        throw new RecordingImportContractError('recording-import-format-mismatch', '录音格式与文件内容不一致')
      }
      return { kind: 'wav', durationMillis: imaAdpcm.durationMillis }
    }

    input = new Input({ source: new FilePathSource(filePath), formats: [WAVE, MP3, MP4] })
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
