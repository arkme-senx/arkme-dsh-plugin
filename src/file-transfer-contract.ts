import type { ArkmeRecordLocationCapture, ArkmeRichSendInput, ArkmeSourceSendResult, ArkmeUploadedAsset } from './types.js'
export const ARKME_TOOL_FILE_MAX_BYTES = 64 * 1024

export interface ArkmeFilePolicy {
  version: 1
  maxFileBytes: number
  maxImageBytes: number
  maxAttachments: number
}

export interface ArkmeLocalFile {
  fileRef: string
  fileName: string
  mimeType: string
  size: number
  fileKind: 1 | 2 | 3 | 4
}

export interface ArkmeFileProgress {
  phase: 'preparing' | 'uploading' | 'completing' | 'ready'
  sentBytes: number
  totalBytes: number
}

export interface ArkmeFileSendInput {
  sourceRef: string
  recordUid: string
  relationUid: string
  fileRefs: string[]
  /** Captured current-account fence. It is validated before acceptance and is never persisted in a task. */
  expectedUserId?: number
  /** Every background ref is also present once in `fileRefs`; the role is never inferred from MIME. */
  backgroundSound?: ArkmeFileBackgroundSoundInput
  /** Send-scoped browser capture persisted until the owner confirms the record and applies its location post-effect. */
  location?: ArkmeRecordLocationCapture
  content: Omit<ArkmeRichSendInput, 'assets' | 'backgroundSound'>
}

export interface ArkmeFileBackgroundSoundInput {
  fileRefs: string[]
  amplitudes: number[]
}

export interface ArkmeFileSendTask extends ArkmeFileSendInput {
  taskRef: string
  createdAtMillis: number
  state: 'queued' | 'uploading' | 'sending' | 'sent' | 'failed' | 'uncertain'
  files: Array<ArkmeLocalFile & { progress: ArkmeFileProgress; asset?: ArkmeUploadedAsset }>
  result?: ArkmeSourceSendResult
  /** Sanitized owner error code. Definite rejection and unknown outcome remain distinct via state. */
  errorCode?: string
  error?: string
}

export interface ArkmeFileReception {
  state: 'missing' | 'receiving' | 'ready' | 'failed'
  receivedBytes: number
  totalBytes: number
  file?: ArkmeLocalFile
  error?: string
}

export interface ArkmeFileOpenResult {
  opened: true
  file: ArkmeLocalFile
}

export function arkmeVisibleUploadFraction(progress: ArkmeFileProgress): number {
  if (progress.phase === 'ready') return 1
  return Math.min(.99, Math.max(0, progress.totalBytes > 0 ? progress.sentBytes / progress.totalBytes : 0))
}

export type ArkmeMediaKind = 'image' | 'video' | 'audio'
type ArkmeBrowserVisualKind = Exclude<ArkmeMediaKind, 'audio'>

const mediaTypesByExtension: Readonly<Record<string, { mimeType: string; kind: ArkmeMediaKind }>> = {
  jpg: { mimeType: 'image/jpeg', kind: 'image' }, jpeg: { mimeType: 'image/jpeg', kind: 'image' },
  png: { mimeType: 'image/png', kind: 'image' }, gif: { mimeType: 'image/gif', kind: 'image' },
  webp: { mimeType: 'image/webp', kind: 'image' }, avif: { mimeType: 'image/avif', kind: 'image' },
  bmp: { mimeType: 'image/bmp', kind: 'image' }, heic: { mimeType: 'image/heic', kind: 'image' },
  heif: { mimeType: 'image/heif', kind: 'image' }, svg: { mimeType: 'image/svg+xml', kind: 'image' },
  tif: { mimeType: 'image/tiff', kind: 'image' }, tiff: { mimeType: 'image/tiff', kind: 'image' },
  mp4: { mimeType: 'video/mp4', kind: 'video' },
  m4v: { mimeType: 'video/mp4', kind: 'video' }, mov: { mimeType: 'video/quicktime', kind: 'video' },
  webm: { mimeType: 'video/webm', kind: 'video' }, ogv: { mimeType: 'video/ogg', kind: 'video' },
  mkv: { mimeType: 'video/x-matroska', kind: 'video' }, avi: { mimeType: 'video/x-msvideo', kind: 'video' },
  mpg: { mimeType: 'video/mpeg', kind: 'video' }, mpeg: { mimeType: 'video/mpeg', kind: 'video' },
  mp3: { mimeType: 'audio/mpeg', kind: 'audio' }, m4a: { mimeType: 'audio/mp4', kind: 'audio' },
  aac: { mimeType: 'audio/aac', kind: 'audio' }, wav: { mimeType: 'audio/wav', kind: 'audio' },
  ogg: { mimeType: 'audio/ogg', kind: 'audio' }, oga: { mimeType: 'audio/ogg', kind: 'audio' },
  flac: { mimeType: 'audio/flac', kind: 'audio' }, opus: { mimeType: 'audio/opus', kind: 'audio' },
}

const safeVisualTypesByExtension: Readonly<Record<string, { mimeType: string; kind: ArkmeBrowserVisualKind }>> = {
  jpg: { mimeType: 'image/jpeg', kind: 'image' }, jpeg: { mimeType: 'image/jpeg', kind: 'image' },
  png: { mimeType: 'image/png', kind: 'image' }, gif: { mimeType: 'image/gif', kind: 'image' },
  webp: { mimeType: 'image/webp', kind: 'image' }, avif: { mimeType: 'image/avif', kind: 'image' },
  bmp: { mimeType: 'image/bmp', kind: 'image' }, mp4: { mimeType: 'video/mp4', kind: 'video' },
  m4v: { mimeType: 'video/mp4', kind: 'video' }, mov: { mimeType: 'video/quicktime', kind: 'video' },
  webm: { mimeType: 'video/webm', kind: 'video' }, ogv: { mimeType: 'video/ogg', kind: 'video' },
}

const safeImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])
const safeVideoMimeTypes = new Set(['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'video/ogg'])
const safeAudioMimeTypes = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg'])

function fileExtension(fileName: string): string | undefined {
  const match = /\.([A-Za-z0-9]+)$/u.exec(fileName.trim())
  return match?.[1]?.toLowerCase()
}

/** Recover the real media MIME when the platform supplied no useful metadata. */
export function arkmeNormalizedFileMimeType(mimeType: string, fileName = ''): string {
  const declared = mimeType.trim().toLowerCase()
  if (declared !== '' && declared !== 'application/octet-stream') return declared
  const extension = fileExtension(fileName)
  return (extension === undefined ? undefined : mediaTypesByExtension[extension]?.mimeType) ?? (declared || 'application/octet-stream')
}

/** Classify presentation independently from whether this browser can decode it inline. */
export function arkmeMediaKind(mimeType: string, fileName = ''): ArkmeMediaKind | undefined {
  const declared = mimeType.trim().toLowerCase()
  const extension = fileExtension(fileName)
  if (extension !== undefined) {
    const byExtension = mediaTypesByExtension[extension]
    if (byExtension === undefined) return undefined
    if (declared === '' || declared === 'application/octet-stream') return byExtension.kind
    if (byExtension.kind === 'image' && declared.startsWith('image/')) return 'image'
    if (byExtension.kind === 'video' && declared.startsWith('video/')) return 'video'
    if (byExtension.kind === 'audio' && declared.startsWith('audio/')) return 'audio'
    return undefined
  }
  if (declared.startsWith('image/')) return 'image'
  if (declared.startsWith('video/')) return 'video'
  if (declared.startsWith('audio/')) return 'audio'
  return undefined
}

/** A filename suffix is authoritative when it contradicts legacy visual metadata. */
export function arkmeBrowserVisualKind(mimeType: string, fileName = ''): ArkmeBrowserVisualKind | undefined {
  const declared = mimeType.trim().toLowerCase()
  const extension = fileExtension(fileName)
  if (extension !== undefined) {
    const byExtension = safeVisualTypesByExtension[extension]
    if (byExtension === undefined) return undefined
    if (declared === '' || declared === 'application/octet-stream') return byExtension.kind
    if (byExtension.kind === 'image' && safeImageMimeTypes.has(declared)) return 'image'
    if (byExtension.kind === 'video' && safeVideoMimeTypes.has(declared)) return 'video'
    return undefined
  }
  if (safeImageMimeTypes.has(declared)) return 'image'
  if (safeVideoMimeTypes.has(declared)) return 'video'
  return undefined
}

export function arkmeCanInlineLocalFile(mimeType: string, fileName = ''): boolean {
  if (arkmeBrowserVisualKind(mimeType, fileName) !== undefined) return true
  const declared = mimeType.trim().toLowerCase()
  const extension = fileExtension(fileName)
  if (!safeAudioMimeTypes.has(declared)) return false
  return extension === undefined || ['mp3', 'm4a', 'wav', 'ogg', 'oga'].includes(extension)
}

/** Picked audio keeps generic upload metadata; presentation still recognizes it as audio. */
export function arkmePickedFileKind(mimeType: string, fileName = ''): ArkmeLocalFile['fileKind'] {
  const normalized = arkmeNormalizedFileMimeType(mimeType, fileName)
  const mediaKind = arkmeMediaKind(normalized, fileName)
  return mediaKind === 'image' ? 1 : mediaKind === 'video' ? 3 : 4
}
