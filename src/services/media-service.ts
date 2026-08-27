import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import OSS from 'ali-oss'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeContentBlock,
  ArkmeFileAssetDisplayItem,
  ArkmeImageBytes,
  ArkmeImageMediaType,
  ArkmeUploadedAsset,
} from '../types.js'
import { ProfileService } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export interface ArkmeWorldImageEntry {
  viewerUserId: number
  sourceUrl: string
  expiresAtMillis: number
}

export interface ArkmeWorldImageReader {
  openWorldImageRef(imageRef: string, viewerUserId: number): Promise<ArkmeWorldImageEntry>
}

export interface ArkmeBotImageReader {
  openBotImageRef(imageRef: string, viewerUserId: number): Promise<ArkmeWorldImageEntry>
}

export interface ArkmeRecordIdentity {
  recordUid(raw: unknown): string
}

export interface ArkmeUnmarkedSpeakerMediaTuple {
  viewerUserId: number
  candidateId: string
  segmentId: string
  sessionId: string
  childId: string
  audioFileName: string
}

export interface ArkmeUnmarkedSpeakerSegmentResolver {
  resolveSegmentForMedia(segmentRef: string, candidateRef: string): Promise<ArkmeUnmarkedSpeakerMediaTuple>
}

export interface ArkmeMediaDescriptor {
  viewerUserId: number
  remoteUrl: string
  mimeType: string
  fileName: string
  size: number
  expiresAtMillis: number
  stableKey?: string
}

interface ArkmePreparedUpload {
  upload_session_uid?: unknown
  upload_url?: unknown
  upload_headers?: unknown
  upload_mode?: unknown
  multipart_part_size?: unknown
  multipart_parts?: unknown
}

interface ArkmeOssCredentials {
  accessKeyId: string
  accessKeySecret: string
  stsToken: string
  expiration: string
}

interface CacheEntry<T> { value: T; expiresAtMillis: number }

export const MAX_ARKME_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_ARKME_PROFILE_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_CACHE_TTL_MS = 5 * 60_000
const IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024
const IMAGE_CACHE_MAX_ENTRIES = 64
const IMAGE_DOWNLOAD_CONCURRENCY = 4
const RECORD_CONTENT_FILE_ROLE_BACKGROUND_SOUND = 4

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function jsonObjectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return objectValue(value)
  try { return objectValue(JSON.parse(value)) } catch { return {} }
}

function safeHttpsUrl(value: unknown): string | undefined {
  const raw = stringValue(value).trim()
  if (raw === '') return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function md5Text(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function allowedSignedImageHost(environment: 'test' | 'prod', hostname: string): boolean {
  const allowed = environment === 'prod'
    ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc']
    : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me']
  return allowed.includes(hostname.toLowerCase())
}

function allowedSignedAudioHost(environment: 'test' | 'prod', hostname: string): boolean {
  const allowed = environment === 'prod'
    ? ['jotmo-useraudio.oss-cn-hangzhou.aliyuncs.com']
    : ['jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com']
  return allowed.includes(hostname.toLowerCase())
}

function trustedWorldVoiceprintAudioUrl(environment: 'test' | 'prod', raw: string): URL {
  let parsed: URL
  try { parsed = new URL(raw.trim()) }
  catch (error) {
    throw new ArkmePluginError('world-voiceprint-audio-invalid', '世界声纹音频地址无效', true, 502, { cause: error })
  }
  const signature = parsed.searchParams.get('x-oss-signature')?.trim() ?? ''
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
    || !allowedSignedAudioHost(environment, parsed.hostname) || parsed.pathname.replace(/^\/+/, '') === ''
    || signature === '') {
    throw new ArkmePluginError('world-voiceprint-audio-rejected', '世界声纹音频来源不受信任', false, 502)
  }
  return parsed
}

function worldVoiceprintFileName(mimeType: string): string {
  const subtype = mimeType.split(';', 1)[0]!.trim().toLowerCase().replace(/^audio\//, '')
  const extension = ({
    wav: 'wav',
    'x-wav': 'wav',
    mpeg: 'mp3',
    mp4: 'm4a',
    aac: 'aac',
    ogg: 'ogg',
    webm: 'webm',
    flac: 'flac',
  } as Record<string, string>)[subtype]
  return extension === undefined ? '世界声纹' : `世界声纹.${extension}`
}

function unmarkedSpeakerAudioType(audioFileName: string): { mimeType: string; fileName: string } {
  const extension = /\.([A-Za-z0-9]{1,10})$/.exec(audioFileName)?.[1]?.toLowerCase() ?? ''
  const mimeType = ({
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
    pcm: 'audio/L16',
  } as Record<string, string>)[extension] ?? 'audio/wav'
  return { mimeType, fileName: extension === '' ? '说话片段' : `说话片段.${extension}` }
}

function audioObjectPathPart(value: string): string | undefined {
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= 512 && normalized !== '.' && normalized !== '..'
    && !/[\\/\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined
}

function trustedSignedImageUrl(environment: 'test' | 'prod', raw: string): URL {
  let parsed: URL
  try { parsed = new URL(raw.trim()) }
  catch (error) {
    throw new ArkmePluginError('image-ref-invalid', 'Arkme头像授权地址无效', false, 400, { cause: error })
  }
  const signature = parsed.searchParams.get('x-oss-signature')?.trim() ?? ''
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
    || !allowedSignedImageHost(environment, parsed.hostname) || parsed.pathname.replace(/^\/+/, '') === ''
    || signature === '') {
    throw new ArkmePluginError('image-sign-target-rejected', 'Arkme头像授权目标不受信任', false, 502)
  }
  return parsed
}

function trustedWorldImageUrl(environment: 'test' | 'prod', raw: string): URL {
  let parsed: URL
  try { parsed = new URL(raw.trim()) }
  catch (error) {
    throw new ArkmePluginError('world-image-ref-invalid', '世界图片地址无效', false, 400, { cause: error })
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
    || !allowedSignedImageHost(environment, parsed.hostname) || parsed.pathname.replace(/^\/+/, '') === '') {
    throw new ArkmePluginError('world-image-target-rejected', '世界图片目标不受信任', false, 502)
  }
  return parsed
}

function imageFileIdFromRef(imageRef: string, userId: number): string {
  const normalized = imageRef.trim()
  if (normalized === '' || normalized.startsWith('phone_avatar://')) {
    throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false)
  }
  let candidate = normalized
  if (/^https?:\/\//i.test(candidate)) {
    let parsed: URL
    try { parsed = new URL(candidate) }
    catch (error) { throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false, 400, { cause: error }) }
    if (parsed.protocol !== 'https:') throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用必须使用安全连接', false)
    candidate = parsed.pathname
  }
  let decoded: string
  try { decoded = decodeURIComponent(candidate) }
  catch (error) { throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false, 400, { cause: error }) }
  const pathMatch = decoded.match(/(?:^|\/)([a-f0-9]{32})\/(\d+)\/([^/]+)$/i)
  const fileId = (pathMatch?.[3] ?? decoded).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(fileId) || fileId.includes('..')) {
    throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false)
  }
  const ownerMatch = /^(\d+)(?:_|$)/.exec(fileId)
  const ownerId = ownerMatch === null ? 0 : Number(ownerMatch[1])
  if (!Number.isSafeInteger(ownerId) || ownerId !== userId) {
    throw new ArkmePluginError('image-owner-mismatch', '头像不属于当前登录的Arkme 账号', false, 403)
  }
  if (pathMatch !== null && (Number(pathMatch[2]) !== userId || pathMatch[1]?.toLowerCase() !== md5Text(String(userId)))) {
    throw new ArkmePluginError('image-owner-mismatch', '头像路径与当前Arkme 账号不匹配', false, 403)
  }
  return fileId
}

function imageMediaType(data: Uint8Array): ArkmeImageMediaType | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const prefix = Buffer.from(data.subarray(0, 6)).toString('ascii')
  if (prefix === 'GIF87a' || prefix === 'GIF89a') return 'image/gif'
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

function cloneImageBytes(value: ArkmeImageBytes): ArkmeImageBytes {
  return { mediaType: value.mediaType, bytes: value.bytes, data: value.data.slice() }
}

export class MediaService {
  private readonly mediaRefs = new Map<string, ArkmeMediaDescriptor>()
  private readonly stableMediaRefs = new Map<string, string>()
  private readonly imageCache = new Map<string, CacheEntry<ArkmeImageBytes>>()
  private readonly imageInFlight = new Map<string, Promise<ArkmeImageBytes>>()
  private imageCacheBytes = 0
  private activeImageDownloads = 0
  private readonly imageDownloadWaiters: Array<() => void> = []

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
    private readonly worldImages: ArkmeWorldImageReader,
    private readonly recordIdentity: ArkmeRecordIdentity,
    private readonly botImages?: ArkmeBotImageReader,
  ) {}

  dispose(): void {
    this.mediaRefs.clear()
    this.stableMediaRefs.clear()
    this.imageCache.clear()
    this.imageInFlight.clear()
    this.imageCacheBytes = 0
    this.imageDownloadWaiters.splice(0).forEach(resolve => { resolve() })
  }

  async queryFileAssets(fileAssetUids: readonly string[], signal?: AbortSignal): Promise<ArkmeFileAssetDisplayItem[]> {
    const unique = [...new Set(fileAssetUids.map(uid => uid.trim()).filter(uid => uid !== ''))].slice(0, 50)
    if (unique.length === 0) return []
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/files/assets/query',
      { file_asset_uids: unique },
      session,
      signal,
    )
    return listValue(data.items).map(raw => {
      const item = objectValue(raw)
      const previewUrl = safeHttpsUrl(item.preview_url)
      const downloadUrl = safeHttpsUrl(item.download_url)
      return {
        fileAssetUid: stringValue(item.file_asset_uid).trim(),
        status: stringValue(item.status).trim(),
        ...(stringValue(item.file_name).trim() === '' ? {} : { fileName: stringValue(item.file_name).trim() }),
        ...(stringValue(item.mime_type).trim() === '' ? {} : { mimeType: stringValue(item.mime_type).trim() }),
        ...(previewUrl === undefined ? {} : { previewUrl }),
        ...(downloadUrl === undefined ? {} : { downloadUrl }),
      }
    }).filter(item => item.fileAssetUid !== '')
  }

  async uploadLocalFile(
    filePath: string,
    metadata: { size: number; sha256: string; mimeType: string; fileName: string; fileKind: 1 | 2 | 3 | 4 },
  ): Promise<ArkmeUploadedAsset> {
    if (this.runtime.config.richMediaSendEnabled === false) {
      throw new ArkmePluginError('rich-content-disabled', '文件上传已被插件配置关闭', false, 403)
    }
    const maxBytes = this.runtime.config.maxUploadBytes ?? 100 * 1024 * 1024
    if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > maxBytes
      || !/^[a-f0-9]{64}$/.test(metadata.sha256) || metadata.fileName.trim() === '') {
      throw new ArkmePluginError('upload-metadata-invalid', '文件为空、过大或元数据无效', false, 400)
    }
    const session = await this.runtime.requireSession()
    const uploadMode = metadata.size > 16 * 1024 * 1024 ? 2 : 1
    const prepared = await this.runtime.authenticatedPost<ArkmePreparedUpload>('/api/v1/files/prepare-upload', {
      planned_size: metadata.size,
      file_hash: metadata.sha256,
      mime_type: metadata.mimeType || 'application/octet-stream',
      file_kind: metadata.fileKind,
      upload_mode: uploadMode,
      display_name: metadata.fileName,
    }, session)
    const uploadSessionUid = stringValue(prepared.upload_session_uid).trim()
    if (uploadSessionUid === '') throw new ArkmePluginError('upload-prepare-invalid', '上传准备响应无效', true, 502)
    try {
      let storageETag = ''
      const completedParts: Array<{ part_number: number; etag: string }> = []
      if (uploadMode === 1) {
        const uploadUrl = stringValue(prepared.upload_url).trim()
        if (uploadUrl === '') throw new ArkmePluginError('upload-url-missing', '对象存储上传地址缺失', true, 502)
        const response = await this.runtime.fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: Object.fromEntries(Object.entries(objectValue(prepared.upload_headers)).map(([key, value]) => [key, stringValue(value)])),
          body: createReadStream(filePath) as never,
          duplex: 'half',
          redirect: 'error',
        } as RequestInit)
        if (!response.ok) throw new ArkmePluginError('upload-storage-failed', `对象存储上传失败（${String(response.status)}）`, true, 502)
        storageETag = response.headers.get('etag') ?? ''
      } else {
        const partSize = Math.trunc(numberValue(prepared.multipart_part_size))
        const parts = listValue(prepared.multipart_parts).map(objectValue)
        if (partSize <= 0 || parts.length === 0) throw new ArkmePluginError('upload-parts-missing', '分片上传参数缺失', true, 502)
        const handle = await openFile(filePath, 'r')
        try {
          for (const part of parts) {
            const partNumber = Math.trunc(numberValue(part.part_number))
            const uploadUrl = stringValue(part.upload_url).trim()
            const offset = (partNumber - 1) * partSize
            const length = Math.min(partSize, metadata.size - offset)
            if (partNumber <= 0 || uploadUrl === '' || length <= 0) throw new ArkmePluginError('upload-part-invalid', '分片上传参数无效', true, 502)
            const buffer = Buffer.allocUnsafe(length)
            const read = await handle.read(buffer, 0, length, offset)
            if (read.bytesRead !== length) throw new ArkmePluginError('upload-part-read-failed', '读取上传分片失败', true, 500)
            const response = await this.runtime.fetchImpl(uploadUrl, {
              method: 'PUT',
              headers: Object.fromEntries(Object.entries(objectValue(part.upload_headers)).map(([key, value]) => [key, stringValue(value)])),
              body: buffer,
              redirect: 'error',
            })
            if (!response.ok) throw new ArkmePluginError('upload-storage-failed', `对象存储分片上传失败（${String(response.status)}）`, true, 502)
            completedParts.push({ part_number: partNumber, etag: response.headers.get('etag') ?? '' })
          }
        } finally { await handle.close() }
      }
      const completed = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/files/complete-upload', {
        upload_session_uid: uploadSessionUid,
        uploaded_size: metadata.size,
        storage_etag: storageETag,
        multipart_parts: completedParts,
      }, session)
      const fileAssetUid = stringValue(completed.file_asset_uid).trim()
      if (fileAssetUid === '') throw new ArkmePluginError('upload-complete-invalid', '上传完成响应无效', true, 502)
      return {
        fileAssetUid,
        fileName: metadata.fileName,
        mimeType: stringValue(completed.mime_type).trim() || metadata.mimeType,
        size: numberValue(completed.size) || metadata.size,
        fileKind: metadata.fileKind,
      }
    } catch (error) {
      await this.runtime.authenticatedPost('/api/v1/files/abort-upload', { upload_session_uid: uploadSessionUid }, session).catch(() => undefined)
      throw error
    }
  }

  async fetchMedia(
    mediaRef: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<{ response: Response; descriptor: ArkmeMediaDescriptor }> {
    const session = await this.runtime.requireSession()
    const descriptor = this.mediaRefs.get(mediaRef)
    if (descriptor === undefined || descriptor.viewerUserId !== session.userId || descriptor.expiresAtMillis <= Date.now()) {
      this.mediaRefs.delete(mediaRef)
      if (descriptor?.stableKey !== undefined) this.stableMediaRefs.delete(descriptor.stableKey)
      throw new ArkmePluginError('media-ref-invalid', '媒体引用已失效，请刷新对话后重试', false, 404)
    }
    const url = new URL(descriptor.remoteUrl)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
      || !(allowedSignedImageHost(this.runtime.config.environment, url.hostname)
        || allowedSignedAudioHost(this.runtime.config.environment, url.hostname))) {
      throw new ArkmePluginError('media-host-rejected', '媒体来源不受信任', false, 403)
    }
    const response = await this.runtime.fetchImpl(url, {
      headers: range === undefined ? {} : { Range: range },
      redirect: 'error',
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok && response.status !== 206) {
      throw new ArkmePluginError('media-fetch-failed', `媒体读取失败（${String(response.status)}）`, true, 502)
    }
    return { response, descriptor }
  }

  issueWorldVoiceprintMediaRef(viewerUserId: number, input: { remoteUrl: string; mimeType: string }): string {
    const remoteUrl = trustedWorldVoiceprintAudioUrl(this.runtime.config.environment, input.remoteUrl).toString()
    const mimeType = input.mimeType.trim() || 'audio/wav'
    if (!mimeType.startsWith('audio/')) {
      throw new ArkmePluginError('world-voiceprint-mime-invalid', '世界声纹音频格式无效', true, 502)
    }
    return this.issueMediaRef(viewerUserId, {
      remoteUrl,
      mimeType,
      fileName: worldVoiceprintFileName(mimeType),
      size: 0,
    })
  }

  async issueUnmarkedSpeakerMediaRef(
    resolver: ArkmeUnmarkedSpeakerSegmentResolver,
    candidateRef: string,
    segmentRef: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const tuple = await resolver.resolveSegmentForMedia(segmentRef, candidateRef)
    const session = await this.runtime.requireSession()
    if (!Number.isSafeInteger(tuple.viewerUserId) || tuple.viewerUserId <= 0 || tuple.viewerUserId !== session.userId) {
      throw new ArkmePluginError('unmarked-audio-account-mismatch', '说话片段与当前账号不匹配', false, 403)
    }
    const sessionId = audioObjectPathPart(tuple.sessionId)
    const childId = audioObjectPathPart(tuple.childId)
    const audioFileName = audioObjectPathPart(tuple.audioFileName)
    if (sessionId === undefined || childId === undefined || audioFileName === undefined) {
      throw new ArkmePluginError('unmarked-audio-path-invalid', '说话片段音频路径无效', false, 502)
    }
    const objectPath = `${md5Text(String(session.userId))}/${String(session.userId)}/audio_output/${sessionId}/${childId}/${audioFileName}`
    const credentials = await this.audioOssCredentials(session, signal)
    const bucket = this.runtime.config.environment === 'prod' ? 'jotmo-useraudio' : 'jotmo-useraudio-test'
    let signedUrlText: string
    try {
      const client = new OSS({
        region: 'oss-cn-hangzhou',
        bucket,
        secure: true,
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        stsToken: credentials.stsToken,
        refreshSTSTokenInterval: 10 * 60 * 1000,
        refreshSTSToken: async () => {
          const refreshed = await this.audioOssCredentials(await this.runtime.requireSession(), signal)
          return {
            accessKeyId: refreshed.accessKeyId,
            accessKeySecret: refreshed.accessKeySecret,
            stsToken: refreshed.stsToken,
          }
        },
      })
      signedUrlText = client.signatureUrl(objectPath, { method: 'GET', expires: 120 })
    } catch (error) {
      throw new ArkmePluginError('unmarked-audio-sign-failed', '说话片段音频授权失败', true, 502, { cause: error })
    }
    let signedUrl: URL
    try {
      signedUrl = new URL(signedUrlText)
    } catch (error) {
      throw new ArkmePluginError('unmarked-audio-sign-contract-invalid', '说话片段音频授权响应无效', true, 502, { cause: error })
    }
    let signedPath: string
    try {
      signedPath = decodeURIComponent(signedUrl.pathname).replace(/^\/+/, '')
    } catch (error) {
      throw new ArkmePluginError('unmarked-audio-sign-contract-invalid', '说话片段音频授权路径无效', true, 502, { cause: error })
    }
    const hasSignature = (signedUrl.searchParams.get('Signature') ?? signedUrl.searchParams.get('x-oss-signature') ?? '').trim() !== ''
    if (signedUrl.protocol !== 'https:' || signedUrl.username !== '' || signedUrl.password !== ''
      || signedUrl.port !== '' || signedUrl.hash !== '' || !hasSignature
      || !allowedSignedAudioHost(this.runtime.config.environment, signedUrl.hostname) || signedPath !== objectPath) {
      throw new ArkmePluginError('unmarked-audio-sign-target-rejected', '说话片段音频授权目标不受信任', false, 502)
    }
    const display = unmarkedSpeakerAudioType(audioFileName)
    return this.issueMediaRef(session.userId, {
      remoteUrl: signedUrl.toString(),
      mimeType: display.mimeType,
      fileName: display.fileName,
      size: 0,
    }, undefined, 110_000)
  }

  async readImage(
    imageRef: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeImageBytes> {
    const session = await this.runtime.requireSession()
    const isProfileImage = imageRef.trim().startsWith('arkme-profile-image-v1.')
    const maximumBytes = isProfileImage ? MAX_ARKME_PROFILE_IMAGE_BYTES : MAX_ARKME_IMAGE_BYTES
    const byteLimit = Math.min(maximumBytes, Math.max(1, Math.trunc(options.maxBytes ?? maximumBytes)))
    const cacheKey = `${String(session.userId)}:${String(byteLimit)}:${imageRef.trim()}`
    const cached = this.cachedImage(cacheKey)
    if (cached !== undefined) return cached
    const existing = this.imageInFlight.get(cacheKey)
    if (existing !== undefined) return cloneImageBytes(await existing)
    const pending = this.withImageDownloadPermit(
      async () => await this.readImageUncached(session, imageRef, byteLimit, options.signal),
    )
    this.imageInFlight.set(cacheKey, pending)
    try {
      const value = await pending
      this.cacheImage(cacheKey, value)
      return cloneImageBytes(value)
    } finally {
      if (this.imageInFlight.get(cacheKey) === pending) this.imageInFlight.delete(cacheKey)
    }
  }

  private cachedImage(cacheKey: string): ArkmeImageBytes | undefined {
    const cached = this.imageCache.get(cacheKey)
    if (cached === undefined) return undefined
    if (cached.expiresAtMillis <= Date.now()) {
      this.imageCache.delete(cacheKey)
      this.imageCacheBytes = Math.max(0, this.imageCacheBytes - cached.value.bytes)
      return undefined
    }
    this.imageCache.delete(cacheKey)
    this.imageCache.set(cacheKey, cached)
    return cloneImageBytes(cached.value)
  }

  private cacheImage(cacheKey: string, value: ArkmeImageBytes): void {
    const previous = this.imageCache.get(cacheKey)
    if (previous !== undefined) this.imageCacheBytes = Math.max(0, this.imageCacheBytes - previous.value.bytes)
    const cached = cloneImageBytes(value)
    this.imageCache.delete(cacheKey)
    this.imageCache.set(cacheKey, { value: cached, expiresAtMillis: Date.now() + IMAGE_CACHE_TTL_MS })
    this.imageCacheBytes += cached.bytes
    while (this.imageCache.size > IMAGE_CACHE_MAX_ENTRIES || this.imageCacheBytes > IMAGE_CACHE_MAX_BYTES) {
      const oldestKey = this.imageCache.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      const oldest = this.imageCache.get(oldestKey)
      this.imageCache.delete(oldestKey)
      if (oldest !== undefined) this.imageCacheBytes = Math.max(0, this.imageCacheBytes - oldest.value.bytes)
    }
  }

  async withImageDownloadPermit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeImageDownloads >= IMAGE_DOWNLOAD_CONCURRENCY) {
      await new Promise<void>(resolve => { this.imageDownloadWaiters.push(resolve) })
    }
    this.activeImageDownloads += 1
    try {
      return await operation()
    } finally {
      this.activeImageDownloads = Math.max(0, this.activeImageDownloads - 1)
      this.imageDownloadWaiters.shift()?.()
    }
  }

  private async readImageUncached(
    session: ArkmeSessionCredentials,
    imageRef: string,
    byteLimit: number,
    signal?: AbortSignal,
  ): Promise<ArkmeImageBytes> {
    if (imageRef.trim().startsWith('arkme-bot-image-v1.')) {
      if (this.botImages === undefined) throw new ArkmePluginError('bot-image-ref-invalid', 'Bot 头像引用不可用', false, 403)
      const reference = await this.botImages.openBotImageRef(imageRef, session.userId)
      return await this.downloadSignedImage(
        trustedSignedImageUrl(this.runtime.config.environment, reference.sourceUrl),
        byteLimit,
        signal,
        this.runtime.requestScope(session.userId),
      )
    }
    if (imageRef.trim().startsWith('arkme-media-v1.')) {
      const { response, descriptor } = await this.fetchMedia(imageRef.trim(), undefined, signal)
      if (!descriptor.mimeType.trim().toLowerCase().startsWith('image/')) {
        throw new ArkmePluginError('image-type-unsupported', '该媒体引用不是图片', false, 415)
      }
      return await this.imageBytesFromResponse(response, byteLimit)
    }
    if (imageRef.trim().startsWith('arkme-profile-image-v1.')) {
      const reference = await this.profile.openProfileImageRef(imageRef, session.userId)
      if (reference.targetUserId === session.userId) {
        let snapshot = await this.runtime.stateStore.cachedProfile(session.userId)
        if ((snapshot.profile?.avatarRef.trim() ?? '') === '') {
          try {
            snapshot = await this.profile.refreshProfileForSession(session)
          } catch {
            // A missing current-user profile may still fall back to the public profile below.
          }
        }
        const ownAvatarRef = snapshot.profile?.avatarRef.trim() ?? ''
        if (ownAvatarRef !== '' && !ownAvatarRef.startsWith('arkme-profile-image-v1.')) {
          return await this.readImage(ownAvatarRef, {
            maxBytes: byteLimit,
            ...(signal === undefined ? {} : { signal }),
          })
        }
      }
      const cachedAvatarUrl = this.profile.cachedPublicProfileAvatar(session.userId, reference.targetUserId)
      let avatarUrl = cachedAvatarUrl
      if (avatarUrl === undefined) {
        avatarUrl = (await this.profile.publicProfilesByUserIds([reference.targetUserId], session, signal))
          .get(reference.targetUserId)?.avatarUrl
      }
      if (avatarUrl === undefined) throw new ArkmePluginError('image-ref-unavailable', 'Arkme头像当前不可用', true, 404)
      try {
        return await this.downloadSignedImage(
          trustedSignedImageUrl(this.runtime.config.environment, avatarUrl), byteLimit, signal, this.runtime.requestScope(session.userId),
        )
      } catch (error) {
        if (cachedAvatarUrl === undefined || cachedAvatarUrl !== avatarUrl) throw error
        this.profile.invalidatePublicProfile(session.userId, reference.targetUserId)
        const refreshedUrl = (await this.profile.publicProfilesByUserIds([reference.targetUserId], session, signal))
          .get(reference.targetUserId)?.avatarUrl
        if (refreshedUrl === undefined) throw error
        return await this.downloadSignedImage(
          trustedSignedImageUrl(this.runtime.config.environment, refreshedUrl), byteLimit, signal, this.runtime.requestScope(session.userId),
        )
      }
    }
    const fileId = imageFileIdFromRef(imageRef, session.userId)
    const objectPath = `${md5Text(String(session.userId))}/${String(session.userId)}/${fileId}`
    const credentials = await this.ossCredentials(session, signal)
    const bucket = this.runtime.config.environment === 'prod' ? 'jotmo-userfiles' : 'jotmo-userfiles-test'
    let signedUrlText: string
    try {
      const client = new OSS({
        region: 'oss-cn-hangzhou',
        bucket,
        secure: true,
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        stsToken: credentials.stsToken,
        refreshSTSTokenInterval: 10 * 60 * 1000,
        refreshSTSToken: async () => {
          const refreshed = await this.ossCredentials(await this.runtime.requireSession(), signal)
          return {
            accessKeyId: refreshed.accessKeyId,
            accessKeySecret: refreshed.accessKeySecret,
            stsToken: refreshed.stsToken,
          }
        },
      })
      signedUrlText = client.signatureUrl(objectPath, {
        method: 'GET',
        expires: 120,
        process: 'image/resize,w_512',
      })
    } catch (error) {
      throw new ArkmePluginError('image-sign-failed', 'Arkme 图片授权签名失败', true, 502, { cause: error })
    }
    let signedUrl: URL
    try {
      signedUrl = new URL(signedUrlText)
    } catch (error) {
      throw new ArkmePluginError('image-sign-contract-invalid', 'Arkme 图片授权响应无效', true, 502, { cause: error })
    }
    let signedPath: string
    try {
      signedPath = decodeURIComponent(signedUrl.pathname).replace(/^\/+/, '')
    } catch (error) {
      throw new ArkmePluginError('image-sign-contract-invalid', 'Arkme 图片授权路径无效', true, 502, { cause: error })
    }
    if (signedUrl.protocol !== 'https:' || signedUrl.username !== '' || signedUrl.password !== ''
      || !allowedSignedImageHost(this.runtime.config.environment, signedUrl.hostname) || signedPath !== objectPath) {
      throw new ArkmePluginError('image-sign-target-rejected', 'Arkme 图片授权目标不受信任', false, 502)
    }
    return await this.downloadSignedImage(signedUrl, byteLimit, signal, this.runtime.requestScope(session.userId))
  }

  private mediaKind(fileKind: number, mimeType: string): ArkmeContentBlock['kind'] {
    if (fileKind === 1 || mimeType.startsWith('image/')) return 'image'
    if (fileKind === 2 || mimeType.startsWith('audio/')) return 'audio'
    if (fileKind === 3 || mimeType.startsWith('video/')) return 'video'
    return 'file'
  }

  recordContentPayload(raw: unknown): Record<string, unknown> {
    const root = objectValue(raw)
    const record = objectValue(root.record)
    const payload = jsonObjectValue(record.payload)
    const core = objectValue(root.record_core)
    return jsonObjectValue(
      root.content_payload ?? root.contentPayload
        ?? payload.content_payload ?? payload.contentPayload
        ?? record.content_payload ?? record.contentPayload
        ?? core.content_payload ?? core.contentPayload,
    )
  }

  /**
   * Older quick-record projections carry their voice outside media_refs.  The
   * Flutter clients accept these payload forms, so normalize them before the
   * shared display-item hydration and rich-content renderer see the record.
   */
  private recordVoiceMediaRef(raw: unknown): Record<string, unknown> | undefined {
    const root = objectValue(raw)
    const record = objectValue(root.record)
    const payload = jsonObjectValue(record.payload)
    const core = objectValue(root.record_core)
    const contentPayload = this.recordContentPayload(raw)
    const candidates = [
      contentPayload.voice, contentPayload.voice_media, contentPayload.voiceMedia,
      payload.voice, payload.voice_media, payload.voiceMedia,
      record.voice, record.voice_media, record.voiceMedia,
      core.voice, core.voice_media, core.voiceMedia,
      root.voice, root.voice_media, root.voiceMedia,
    ]
    for (const candidate of candidates) {
      const voice = jsonObjectValue(candidate)
      const fileAssetUid = [
        voice.source_file_asset_uid, voice.sourceFileAssetUid,
        voice.file_asset_uid, voice.fileAssetUid,
        voice.file_id, voice.fileId, voice.uid,
      ].map(value => stringValue(value).trim()).find(value => value !== '')
      if (fileAssetUid === undefined) continue
      const durationSeconds = numberValue(voice.duration_sec ?? voice.durationSec ?? voice.duration)
      const durationMillis = numberValue(voice.duration_millis ?? voice.durationMillis ?? voice.duration_ms)
      return {
        ...voice,
        file_asset_uid: fileAssetUid,
        file_kind: 2,
        ...(stringValue(voice.mime_type ?? voice.mimeType).trim() === '' ? {} : {
          mime_type: stringValue(voice.mime_type ?? voice.mimeType).trim(),
        }),
        ...(durationSeconds > 0 ? { duration_sec: durationSeconds }
          : durationMillis > 0 ? { duration_sec: Math.ceil(durationMillis / 1000) }
            : {}),
      }
    }
    return undefined
  }

  private recordMediaRefs(raw: unknown): Record<string, unknown>[] {
    const contentPayload = this.recordContentPayload(raw)
    const voiceRef = this.recordVoiceMediaRef(raw)
    const refs = [
      ...listValue(contentPayload.media_refs ?? contentPayload.mediaRefs).map(objectValue),
      ...(voiceRef === undefined ? [] : [voiceRef]),
    ].filter(item => Math.trunc(numberValue(item.content_file_role)) !== RECORD_CONTENT_FILE_ROLE_BACKGROUND_SOUND
      && stringValue(item.file_asset_uid).trim() !== '')
    return [...new Map(refs.map(item => [stringValue(item.file_asset_uid).trim(), item])).values()]
  }

  private async queryRecordMediaDisplayItems(
    recordUids: string[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<string, unknown[]>> {
    const expectedRecordUids = [...new Set(recordUids.map(value => value.trim()).filter(value => value !== ''))]
    const displayItemsByRecordUid = new Map<string, unknown[]>()
    if (expectedRecordUids.length === 0) return displayItemsByRecordUid
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/media/batch-list',
      { record_uids: expectedRecordUids },
      session,
      signal,
      {
        lane: 'interactive-read',
        scope: 'record-media-page',
        key: expectedRecordUids.join(','),
        cacheMs: 1_000,
      },
    )
    // The deployed Record owner names the per-record projection array `items`.
    // Accept the older `results` draft as a read-only compatibility fallback.
    for (const rawResult of listValue(data.items ?? data.results)) {
      const result = objectValue(rawResult)
      const recordUid = stringValue(result.record_uid).trim()
      if (recordUid === '' || !expectedRecordUids.includes(recordUid)) continue
      displayItemsByRecordUid.set(recordUid, listValue(result.items))
    }
    return displayItemsByRecordUid
  }

  async issueSearchAudioMediaRefs(
    requests: Array<{ recordUid: string; fileAssetUid: string }>,
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const normalized = [...new Map(requests.map(request => {
      const recordUid = request.recordUid.trim()
      const fileAssetUid = request.fileAssetUid.trim()
      return [`${recordUid}\0${fileAssetUid}`, { recordUid, fileAssetUid }] as const
    }).filter(([, request]) => request.recordUid !== '' && request.fileAssetUid !== '')).values()].slice(0, 50)
    const mediaRefs = new Map<string, string>()
    if (normalized.length === 0 || this.runtime.config.richMediaRenderEnabled === false) return mediaRefs
    const session = await this.runtime.requireSession()
    const displayItemsByRecordUid = await this.queryRecordMediaDisplayItems(
      normalized.map(request => request.recordUid),
      session,
      signal,
    )
    for (const request of normalized) {
      const rawItem = (displayItemsByRecordUid.get(request.recordUid) ?? []).find(raw => {
        return stringValue(objectValue(raw).file_asset_uid).trim() === request.fileAssetUid
      })
      const item = objectValue(rawItem)
      const remoteUrl = safeHttpsUrl(item.download_url ?? item.preview_url)
      if (remoteUrl === undefined) continue
      const parsedUrl = new URL(remoteUrl)
      const mimeType = stringValue(item.mime_type).trim() || 'audio/mpeg'
      if (!allowedSignedAudioHost(this.runtime.config.environment, parsedUrl.hostname) || !mimeType.startsWith('audio/')) continue
      const key = `${request.recordUid}\0${request.fileAssetUid}`
      mediaRefs.set(key, this.issueMediaRef(session.userId, {
        remoteUrl,
        mimeType,
        fileName: stringValue(item.file_name).trim() || '语音',
        size: Math.max(0, numberValue(item.size)),
      }, `search-audio\0${key}`))
    }
    return mediaRefs
  }

  async hydrateRecordMediaPage(
    rawItems: unknown[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<{
      displayItemsByRecordUid: Map<string, unknown[]>
      unavailableRecordUids: Set<string>
    }> {
    const displayItemsByRecordUid = new Map<string, unknown[]>()
    const expectedRecordUids = [...new Set(rawItems.flatMap(raw => {
      const recordUid = this.recordIdentity.recordUid(raw)
      return recordUid !== '' && this.recordMediaRefs(raw).length > 0 ? [recordUid] : []
    }))]
    const unavailableRecordUids = new Set<string>()
    if (this.runtime.config.richMediaRenderEnabled === false || expectedRecordUids.length === 0) {
      return { displayItemsByRecordUid, unavailableRecordUids }
    }
    try {
      const queriedItems = await this.queryRecordMediaDisplayItems(expectedRecordUids, session, signal)
      for (const [recordUid, items] of queriedItems) {
        displayItemsByRecordUid.set(recordUid, items)
        const hasDeliverableItem = items.some(rawItem => {
          const item = objectValue(rawItem)
          return stringValue(item.preview_url ?? item.download_url).trim() !== ''
        })
        if (!hasDeliverableItem) unavailableRecordUids.add(recordUid)
      }
      for (const recordUid of expectedRecordUids) {
        if (!displayItemsByRecordUid.has(recordUid)) unavailableRecordUids.add(recordUid)
      }
    } catch (error) {
      if (signal?.aborted === true) throw error
      for (const recordUid of expectedRecordUids) unavailableRecordUids.add(recordUid)
    }
    return { displayItemsByRecordUid, unavailableRecordUids }
  }

  /** Only the already-authorized received snapshot is used; never hydrate its source IDs. */
  forwardContentBlocks(files: unknown[], viewerUserId: number): ArkmeContentBlock[] {
    if (this.runtime.config.richMediaRenderEnabled === false) return []
    const displayItems = files.slice(0, 32).map(objectValue).flatMap((file, index) => {
      if (numberValue(file.content_file_role) === RECORD_CONTENT_FILE_ROLE_BACKGROUND_SOUND) return []
      const trustedUrl = (raw: unknown): string | undefined => {
        const value = safeHttpsUrl(raw)
        if (value === undefined) return undefined
        const url = new URL(value)
        return url.port === '' && url.hash === '' && (allowedSignedImageHost(this.runtime.config.environment, url.hostname)
          || allowedSignedAudioHost(this.runtime.config.environment, url.hostname)) ? value : undefined
      }
      const downloadUrl = trustedUrl(file.download_url ?? file.downloadUrl)
      const previewUrl = trustedUrl(file.preview_url ?? file.previewUrl)
      return [{
        // Do not copy file/source IDs into the public projection or stable media cache.
        file_name: stringValue(file.name ?? file.file_name ?? file.fileName),
        file_kind: numberValue(file.type ?? file.file_kind ?? file.fileKind),
        mime_type: stringValue(file.mime_type ?? file.mimeType),
        size: numberValue(file.size), sort_order: numberValue(file.order ?? file.sort_order ?? index),
        duration_sec: numberValue(file.duration_sec ?? file.durationSec),
        ...(downloadUrl === undefined ? {} : { download_url: downloadUrl }),
        ...(previewUrl === undefined ? {} : { preview_url: previewUrl }),
      }]
    })
    return this.richContentBlocks({}, viewerUserId, displayItems)
  }

  issueImageMediaRef(
    viewerUserId: number,
    descriptor: Omit<ArkmeMediaDescriptor, 'viewerUserId' | 'expiresAtMillis' | 'stableKey'>,
    stableIdentity: string,
  ): string {
    return this.issueMediaRef(viewerUserId, descriptor, stableIdentity)
  }

  favoriteStickerMediaRef(raw: unknown, viewerUserId: number): string | undefined {
    const item = objectValue(raw)
    const remoteUrl = stringValue(item.preview_url ?? item.download_url).trim()
    if (remoteUrl === '') return undefined
    const fileAssetUid = stringValue(item.file_asset_uid).trim()
    const fileName = stringValue(item.file_name).trim() || '收藏表情'
    const mimeType = stringValue(item.mime_type).trim() || 'image/*'
    return this.issueMediaRef(viewerUserId, {
      remoteUrl,
      mimeType,
      fileName,
      size: Math.max(0, Math.trunc(numberValue(item.file_size ?? item.size))),
    }, fileAssetUid === '' ? undefined : `favorite-sticker:${fileAssetUid}`)
  }

  private issueMediaRef(
    viewerUserId: number,
    descriptor: Omit<ArkmeMediaDescriptor, 'viewerUserId' | 'expiresAtMillis' | 'stableKey'>,
    stableIdentity?: string,
    lifetimeMillis?: number,
  ): string {
    const now = Date.now()
    for (const [key, value] of this.mediaRefs) {
      if (value.expiresAtMillis <= now) {
        this.mediaRefs.delete(key)
        if (value.stableKey !== undefined) this.stableMediaRefs.delete(value.stableKey)
      }
    }
    while (this.mediaRefs.size >= 2_000) {
      const oldest = this.mediaRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      const oldestDescriptor = this.mediaRefs.get(oldest)
      this.mediaRefs.delete(oldest)
      if (oldestDescriptor?.stableKey !== undefined) this.stableMediaRefs.delete(oldestDescriptor.stableKey)
    }
    const stableKey = stableIdentity === undefined
      ? undefined
      : createHash('sha256').update(`${String(viewerUserId)}\0${stableIdentity}`).digest('base64url')
    const cachedRef = stableKey === undefined ? undefined : this.stableMediaRefs.get(stableKey)
    const ref = cachedRef ?? `arkme-media-v1.${randomUUID()}`
    this.mediaRefs.delete(ref)
    const resolvedLifetimeMillis = lifetimeMillis ?? (stableKey === undefined ? 30 * 60_000 : 24 * 60 * 60_000)
    this.mediaRefs.set(ref, { ...descriptor, viewerUserId, expiresAtMillis: now + resolvedLifetimeMillis, ...(stableKey === undefined ? {} : { stableKey }) })
    if (stableKey !== undefined) this.stableMediaRefs.set(stableKey, ref)
    return ref
  }

  richContentBlocks(raw: unknown, viewerUserId: number, hydratedDisplayItems: unknown[] = []): ArkmeContentBlock[] {
    if (this.runtime.config.richMediaRenderEnabled === false) return []
    const root = objectValue(raw)
    const record = objectValue(root.record)
    const payload = jsonObjectValue(record.payload)
    const core = objectValue(root.record_core)
    const contentPayload = this.recordContentPayload(raw)
    const displayItems = [
      ...listValue(root.media_display_items),
      ...listValue(record.media_display_items),
      ...listValue(payload.media_display_items),
      ...listValue(core.media_display_items),
      ...hydratedDisplayItems,
    ].map(objectValue)
    const displayByAsset = new Map<string, Record<string, unknown>>()
    for (const item of displayItems) {
      const uid = stringValue(item.file_asset_uid).trim()
      if (uid !== '') displayByAsset.set(uid, item)
    }
    const mediaRefs = this.recordMediaRefs(raw)
    const candidates = mediaRefs.length > 0
      ? mediaRefs.map(ref => ({ ...(displayByAsset.get(stringValue(ref.file_asset_uid).trim()) ?? {}), ...ref }))
      : displayItems
    return candidates.filter(item => {
      // content_file_role=4 is ambient background sound captured while writing a record.
      // It is author-only record metadata, not an attachment that belongs in a chat bubble.
      return Math.trunc(numberValue(item.content_file_role)) !== RECORD_CONTENT_FILE_ROLE_BACKGROUND_SOUND
    }).flatMap((item, index): ArkmeContentBlock[] => {
      const fileAssetUid = stringValue(item.file_asset_uid).trim()
      const mimeType = stringValue(item.mime_type).trim() || 'application/octet-stream'
      const fileName = stringValue(item.file_name).trim() || `附件-${String(index + 1)}`
      const fileKind = Math.trunc(numberValue(item.file_kind))
      const kind = this.mediaKind(fileKind, mimeType)
      const remoteUrl = stringValue(kind === 'image' ? item.preview_url ?? item.download_url : item.download_url).trim()
      if (remoteUrl === '') return []
      return [{
        kind,
        mediaRef: this.issueMediaRef(viewerUserId, {
          remoteUrl, mimeType, fileName, size: Math.max(0, Math.trunc(numberValue(item.size))),
        }, kind === 'image' && fileAssetUid !== '' ? fileAssetUid : undefined),
        ...(fileAssetUid === '' ? {} : { fileAssetUid }),
        fileName,
        mimeType,
        size: Math.max(0, Math.trunc(numberValue(item.size))),
        ...(numberValue(item.duration_sec) > 0 ? { durationSec: numberValue(item.duration_sec) } : {}),
        sortOrder: Math.trunc(numberValue(item.sort_order ?? index)),
        ...([1, 3].includes(Math.trunc(numberValue(item.render_role)))
          ? { renderRole: Math.trunc(numberValue(item.render_role)) as 1 | 3 }
          : {}),
      }]
    }).sort((left, right) => left.sortOrder - right.sortOrder)
  }

  private async ossCredentials(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeOssCredentials> {
    const credentials = await this.runtime.authenticatedAuthGet<Record<string, unknown>>(
      `/api/v1/synch/get/sts-credentials?md_5_user_id=${encodeURIComponent(md5Text(String(session.userId)))}`,
      session,
      signal,
    )
    const normalized = {
      accessKeyId: stringValue(credentials.access_key_id).trim(),
      accessKeySecret: stringValue(credentials.access_key_secret).trim(),
      stsToken: stringValue(credentials.security_token).trim(),
      expiration: stringValue(credentials.expiration).trim(),
    }
    if (normalized.accessKeyId === '' || normalized.accessKeySecret === '' || normalized.stsToken === ''
      || normalized.expiration === '' || !Number.isFinite(Date.parse(normalized.expiration))
      || Date.parse(normalized.expiration) <= Date.now()) {
      throw new ArkmePluginError('image-sts-contract-invalid', 'Arkme 图片授权凭据无效或已过期', true, 502)
    }
    return normalized
  }

  private async audioOssCredentials(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeOssCredentials> {
    const credentials = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-sts-token', {}, session, signal, { lane: 'interactive-read', bypassCache: true },
    )
    const normalized = {
      accessKeyId: stringValue(credentials.access_key_id).trim(),
      accessKeySecret: stringValue(credentials.access_key_secret).trim(),
      stsToken: stringValue(credentials.security_token).trim(),
      expiration: stringValue(credentials.expiration).trim(),
    }
    if (normalized.accessKeyId === '' || normalized.accessKeySecret === '' || normalized.stsToken === ''
      || normalized.expiration === '' || !Number.isFinite(Date.parse(normalized.expiration))
      || Date.parse(normalized.expiration) <= Date.now()) {
      throw new ArkmePluginError('unmarked-audio-sts-contract-invalid', '说话片段音频授权凭据无效或已过期', true, 502)
    }
    return normalized
  }

  async downloadSignedImage(
    signedUrl: URL,
    byteLimit: number,
    signal?: AbortSignal,
    scope = 'public',
  ): Promise<ArkmeImageBytes> {
    return await this.runtime.requestCoordinator.run({
      scope,
      lane: 'image',
      service: 'oss',
      ...(signal === undefined ? {} : { signal }),
      operation: async coordinatedSignal => await this.downloadSignedImageDirect(
        signedUrl, byteLimit, coordinatedSignal,
      ),
    })
  }

  private async downloadSignedImageDirect(
    signedUrl: URL,
    byteLimit: number,
    signal: AbortSignal,
  ): Promise<ArkmeImageBytes> {
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.runtime.config.requestTimeoutMs)
    try {
      const response = await this.runtime.fetchImpl(signedUrl, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new ArkmePluginError('image-download-failed', `Arkme 图片读取返回 HTTP ${response.status}`, true, 502)
      }
      return await this.imageBytesFromResponse(response, byteLimit)
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('image-download-timeout', 'Arkme 图片读取超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('image-download-failed', '无法读取 Arkme 图片', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async imageBytesFromResponse(response: Response, byteLimit: number): Promise<ArkmeImageBytes> {
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
      throw new ArkmePluginError('image-too-large', 'Arkme 图片超过读取大小限制', false, 413)
    }
    if (response.body === null) {
      throw new ArkmePluginError('image-response-empty', 'Arkme 图片响应为空', true, 502)
    }
    const chunks: Uint8Array[] = []
    let bytes = 0
    const reader = response.body.getReader()
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > byteLimit) {
        await reader.cancel()
        throw new ArkmePluginError('image-too-large', 'Arkme 图片超过读取大小限制', false, 413)
      }
      chunks.push(next.value)
    }
    if (bytes === 0) throw new ArkmePluginError('image-response-empty', 'Arkme 图片响应为空', true, 502)
    const data = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    const mediaType = imageMediaType(data)
    if (mediaType === undefined) {
      throw new ArkmePluginError('image-type-unsupported', 'Arkme 图片不是受支持的 PNG、JPEG、WebP 或 GIF', false, 415)
    }
    return { mediaType, bytes, data }
  }
}
