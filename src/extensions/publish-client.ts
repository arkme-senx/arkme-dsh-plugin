import { ArkmePluginError } from '../arkme-service.js'
import { ARKME_EXTENSION_FORMAT, ARKME_EXTENSION_FORMAT_VERSION,
  ARKME_EXTENSION_ICON_MAX_BYTES, ARKME_EXTENSION_MAX_BYTES, ARKME_EXTENSION_PREVIEW_MAX_BYTES,
  type ArkmeExtensionArtifact, type ArkmeExtensionCatalogItem,
  type ArkmeExtensionCatalogPage, type ArkmeExtensionDeleteResult, type ArkmeExtensionIconMediaType,
  type ArkmeExtensionIconResolution, type ArkmeExtensionIconResult, type ArkmeExtensionIconUploadSession,
  type ArkmeExtensionPreviewGallery, type ArkmeExtensionPreviewMediaType,
  type ArkmeExtensionPreviewResolution, type ArkmeExtensionPreviewUploadSession,
  type ArkmeExtensionInstallResolution, type ArkmeExtensionPublishResult,
  type ArkmeExtensionEditableVisibility, type ArkmeExtensionMetadataUpdateResult,
  type ArkmeBundlePublishSession, type ArkmeExtensionPublishSession,
  type ArkmeExtensionUpdateResolution, type ArkmeExtensionVisibility,
  type ArkmeExtensionReviewWireCreateResult, type ArkmeExtensionReviewWirePage,
	type ArkmeExtensionShare,
  type ArkmeInstalledExtension,
  type ArkmeExtensionManifest,
} from './types.js'
import { assertExtensionArtifactSize } from './artifact.js'
import {
  ARKME_BUNDLE_ARTIFACT_KIND, ARKME_BUNDLE_CONTRACT_VERSION, ARKME_BUNDLE_MAX_BYTES,
  type ArkmeBundleArtifact, type ArkmeBundlePublishSource,
} from './bundle-artifact.js'
import type { ArkmeExtensionUploadSlot } from './types.js'

export type ExtensionAuthenticatedPost = <T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<T>

export interface ExtensionDownloadProgress {
  downloadedBytes: number
  totalBytes?: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function legacyManifest(value: unknown): ArkmeExtensionManifest | undefined {
  const manifest = record(value)
  const runtime = record(manifest?.runtime)
  const halves = record(manifest?.halves)
  const entrypoints = record(manifest?.entrypoints)
  const permissions = manifest?.permissions
  if (manifest?.format !== ARKME_EXTENSION_FORMAT || manifest.format_version !== ARKME_EXTENSION_FORMAT_VERSION
    || typeof manifest.name !== 'string' || typeof manifest.description !== 'string' || typeof manifest.version !== 'string'
    || typeof runtime?.dsh !== 'string' || typeof runtime.arkme_provider_contract !== 'number'
    || typeof halves?.host !== 'boolean' || typeof halves.client !== 'boolean'
    || !Array.isArray(permissions) || !permissions.every(permission => typeof permission === 'string')
    || entrypoints === undefined
    || (entrypoints.host !== undefined && entrypoints.host !== 'host.js')
    || (entrypoints.client !== undefined && entrypoints.client !== 'client.js')) return undefined
  return {
    format: ARKME_EXTENSION_FORMAT,
    format_version: ARKME_EXTENSION_FORMAT_VERSION,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    runtime: { dsh: runtime.dsh, arkme_provider_contract: runtime.arkme_provider_contract },
    halves: { host: halves.host, client: halves.client },
    permissions: [...permissions],
    entrypoints: {
      ...(entrypoints.host === 'host.js' ? { host: 'host.js' as const } : {}),
      ...(entrypoints.client === 'client.js' ? { client: 'client.js' as const } : {}),
    },
  }
}

function catalogItemWithSafeManifest(item: ArkmeExtensionCatalogItem): ArkmeExtensionCatalogItem {
  const { manifest: manifestValue, ...rest } = item
  const manifest = legacyManifest(manifestValue)
  return { ...rest, ...(manifest === undefined ? {} : { manifest }) }
}

export class ExtensionPublishClient {
  constructor(
    private readonly post: ExtensionAuthenticatedPost,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async createPublishSession(input: {
    extension_id?: string
    name: string
    description: string
    version: string
    visibility: ArkmeExtensionVisibility
    changelog?: string
    artifact_size: number
    artifact_sha256: string
    manifest_sha256: string
    manifest: Record<string, unknown>
    idempotency_key: string
  }, signal?: AbortSignal): Promise<ArkmeExtensionPublishSession> {
    assertExtensionArtifactSize(input.artifact_size)
    return await this.post('/api/v1/extensions/publish-session/create', input, signal)
  }

  async createBundlePublishSession(input: {
    extension_id?: string
    name: string
    description: string
    visibility: ArkmeExtensionVisibility
    changelog?: string
    idempotency_key: string
    bundle: ArkmeBundleArtifact
    source: ArkmeBundlePublishSource['source']
	listingSource?: { type: 'github_repository'; url: string }
  }, signal?: AbortSignal): Promise<ArkmeBundlePublishSession> {
    if (input.bundle.bytes.byteLength <= 0 || input.bundle.bytes.byteLength > ARKME_BUNDLE_MAX_BYTES
      || input.source.bytes.byteLength <= 0 || input.source.bytes.byteLength > ARKME_BUNDLE_MAX_BYTES) {
      throw new ArkmePluginError('extension-bundle-size-invalid', '扩展 Bundle 或源码大小无效', false, 400)
    }
    return await this.post('/api/v1/extensions/publish-session/create', {
      artifact_contract_version: ARKME_BUNDLE_CONTRACT_VERSION,
      artifact_kind: ARKME_BUNDLE_ARTIFACT_KIND,
      ...(input.extension_id === undefined ? {} : { extension_id: input.extension_id }),
      name: input.name,
      description: input.description,
      package_name: input.bundle.packageName,
      version: input.bundle.version,
      execution_model: input.bundle.executionModel,
      visibility: input.visibility,
      ...(input.changelog === undefined ? {} : { changelog: input.changelog }),
      bundle_size: input.bundle.bytes.byteLength,
      bundle_sha256: input.bundle.bundleSha256,
      package_json_sha256: input.bundle.packageJsonSha256,
      source_size: input.source.bytes.byteLength,
      source_sha256: input.source.sourceSha256,
		...(input.listingSource === undefined ? {} : { source: input.listingSource }),
      idempotency_key: input.idempotency_key,
    }, signal)
  }

  async uploadBundle(slot: ArkmeExtensionUploadSlot, bundle: ArkmeBundleArtifact, signal?: AbortSignal): Promise<void> {
    await this.uploadBytes(slot, bundle.bytes, 'application/vnd.dsh.bundle+gzip', 'Bundle', signal)
  }

  async uploadSource(
    slot: ArkmeExtensionUploadSlot,
    source: ArkmeBundlePublishSource['source'],
    signal?: AbortSignal,
  ): Promise<void> {
    await this.uploadBytes(slot, source.bytes, 'application/vnd.arkme.extension-source+gzip', '源码', signal)
  }

  async uploadArtifact(
    uploadUrl: string,
    artifact: ArkmeExtensionArtifact,
    uploadHeaders: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    assertExtensionArtifactSize(artifact.bytes.byteLength)
    let url: URL
    try { url = new URL(uploadUrl) } catch (error) {
      throw new ArkmePluginError('extension-upload-url-invalid', '扩展市场返回了无效上传地址', false, 502, { cause: error })
    }
    assertSafeArtifactUrl(url, 'upload')
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers = safeSignedHeaders(uploadHeaders)
      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          ...headers,
          ...Object.keys(headers).some(key => key.toLowerCase() === 'content-type')
            ? {}
            : { 'Content-Type': 'application/vnd.arkme.extension+gzip' },
        },
        body: artifact.bytes as BodyInit,
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        throw new ArkmePluginError('extension-upload-failed', `扩展制品上传返回 HTTP ${response.status}`, true, 502)
      }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('extension-upload-timeout', '扩展制品上传超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('extension-upload-failed', '无法上传扩展制品', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async uploadBytes(
    slot: ArkmeExtensionUploadSlot,
    bytes: Uint8Array,
    contentType: string,
    label: string,
    signal?: AbortSignal,
  ): Promise<void> {
    let url: URL
    try { url = new URL(slot.url) } catch (error) {
      throw new ArkmePluginError('extension-upload-url-invalid', `扩展${label}上传地址无效`, false, 502, { cause: error })
    }
    assertSafeArtifactUrl(url, 'upload')
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers = safeSignedHeaders(slot.headers ?? {})
      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          ...headers,
          ...Object.keys(headers).some(key => key.toLowerCase() === 'content-type') ? {} : { 'Content-Type': contentType },
        },
        body: bytes as BodyInit,
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) throw new ArkmePluginError('extension-upload-failed', `扩展${label}上传返回 HTTP ${response.status}`, true, 502)
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('extension-upload-timeout', `扩展${label}上传超时或已取消`, true, 504, { cause: error })
      }
      throw new ArkmePluginError('extension-upload-failed', `无法上传扩展${label}`, true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  async completePublishSession(publishSessionId: string, signal?: AbortSignal): Promise<ArkmeExtensionPublishResult> {
    try {
      return await this.post('/api/v1/extensions/publish-session/complete', {
        publish_session_id: publishSessionId,
      }, signal)
    } catch (error) {
      if (error instanceof ArkmePluginError && error.upstreamStatus === 409
        && ['制品尚未上传完成', '源码尚未上传完成'].some(message => error.message.includes(message))) {
        throw new ArkmePluginError(
          'extension-publish-upload-pending',
          error.message,
          true,
          409,
          { cause: error, upstreamStatus: error.upstreamStatus, ...(error.retryAfterMillis === undefined ? {} : { retryAfterMillis: error.retryAfterMillis }) },
        )
      }
      throw error
    }
  }

  async publishStatus(publishSessionId: string, signal?: AbortSignal): Promise<ArkmeExtensionPublishResult> {
    return await this.post('/api/v1/extensions/publish-session/status', {
      publish_session_id: publishSessionId,
    }, signal)
  }

	async rotateShareLink(extensionId: string, clientMutationId: string, signal?: AbortSignal): Promise<ArkmeExtensionShare> {
		return await this.post('/api/v1/extensions/share/rotate', {
			extension_id: extensionId,
			client_mutation_id: clientMutationId,
		}, signal)
	}

  async list(input: { query?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.post('/api/public/v1/extensions/list', input, signal)
  }

  async detail(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionCatalogItem> {
    const response = await this.post<ArkmeExtensionCatalogItem | {
      extension: ArkmeExtensionCatalogItem
      latest_version?: string | { version?: string; manifest?: ArkmeExtensionCatalogItem['manifest'] }
    }>('/api/public/v1/extensions/detail', { extension_id: extensionId }, signal)
    if (!('extension' in response)) return catalogItemWithSafeManifest(response)
    const latest = response.latest_version
    const extension = catalogItemWithSafeManifest(response.extension)
    const latestManifest = latest !== null && typeof latest === 'object'
      ? legacyManifest(latest.manifest)
      : undefined
    return {
      ...extension,
      ...(typeof latest === 'string' ? { latest_stable_version: latest } : {}),
      ...(latest !== null && typeof latest === 'object' && typeof latest.version === 'string'
        ? {
            latest_stable_version: latest.version,
            version: latest.version,
            ...(latestManifest === undefined ? {} : { manifest: latestManifest }),
          }
        : {}),
    }
  }

  async versions(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.post('/api/public/v1/extensions/version-list', { extension_id: extensionId }, signal)
  }

  async myList(input: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.post('/api/v1/extensions/my-list', input, signal)
  }

  async updateMetadata(input: {
    extension_id: string
    name: string
    description: string
    visibility: ArkmeExtensionEditableVisibility
    client_mutation_id: string
  }, signal?: AbortSignal): Promise<ArkmeExtensionMetadataUpdateResult> {
    try {
      return await this.post('/api/v1/extensions/metadata/update', input, signal)
    } catch (error) {
      throw extensionMetadataError(error)
    }
  }

  async listReviews(
    extensionId: string,
    input: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionReviewWirePage> {
    return await this.post('/api/public/v1/extensions/reviews/list', {
      extension_id: extensionId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.offset === undefined ? {} : { offset: input.offset }),
    }, signal)
  }

  async createReview(input: {
    extensionId: string
    recordUid: string
    parentReviewId?: string
    textContent: string
    rating?: number
    clientMutationId: string
  }, signal?: AbortSignal): Promise<ArkmeExtensionReviewWireCreateResult> {
    return await this.post('/api/v1/extensions/reviews/create', {
      extension_id: input.extensionId,
      record_uid: input.recordUid,
      ...(input.parentReviewId === undefined ? {} : { parent_review_id: input.parentReviewId }),
      text_content: input.textContent,
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      client_mutation_id: input.clientMutationId,
    }, signal)
  }

  async deleteExtension(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionDeleteResult> {
    return await this.post('/api/v1/extensions/delete', { extension_id: extensionId }, signal)
  }

  async createIconUploadSession(input: {
    extension_id: string
    content_type: ArkmeExtensionIconMediaType
    icon_size: number
    icon_sha256: string
    idempotency_key: string
  }, signal?: AbortSignal): Promise<ArkmeExtensionIconUploadSession> {
    if (input.icon_size <= 0 || input.icon_size > ARKME_EXTENSION_ICON_MAX_BYTES) {
      throw new ArkmePluginError('extension-icon-size-invalid', '扩展头像必须小于 2 MiB', false, 400)
    }
    return await this.post('/api/v1/extensions/icon-upload-session/create', input, signal)
  }

  async uploadIcon(
    uploadUrl: string,
    data: Uint8Array,
    mediaType: ArkmeExtensionIconMediaType,
    uploadHeaders: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    if (data.byteLength <= 0 || data.byteLength > ARKME_EXTENSION_ICON_MAX_BYTES) {
      throw new ArkmePluginError('extension-icon-size-invalid', '扩展头像必须小于 2 MiB', false, 400)
    }
    let url: URL
    try { url = new URL(uploadUrl) } catch (error) {
      throw new ArkmePluginError('extension-icon-upload-url-invalid', '扩展市场返回了无效头像上传地址', false, 502, { cause: error })
    }
    assertSafeArtifactUrl(url, 'upload')
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers = safeSignedHeaders(uploadHeaders)
      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          ...headers,
          ...Object.keys(headers).some(key => key.toLowerCase() === 'content-type') ? {} : { 'Content-Type': mediaType },
        },
        body: data as BodyInit,
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        throw new ArkmePluginError('extension-icon-upload-failed', `扩展头像上传返回 HTTP ${String(response.status)}`, true, 502)
      }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('extension-icon-upload-timeout', '扩展头像上传超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('extension-icon-upload-failed', '无法上传扩展头像', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  async completeIconUploadSession(iconUploadSessionId: string, signal?: AbortSignal): Promise<ArkmeExtensionIconResult> {
    return await this.post('/api/v1/extensions/icon-upload-session/complete', {
      icon_upload_session_id: iconUploadSessionId,
    }, signal)
  }

  async resolveIcon(extensionId: string, iconRef: string, signal?: AbortSignal): Promise<ArkmeExtensionIconResolution> {
    return await this.post('/api/v1/extensions/icon-resolve', {
      extension_id: extensionId,
      icon_ref: iconRef,
    }, signal)
  }

  async downloadIcon(
    resolution: ArkmeExtensionIconResolution,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let url: URL
    try { url = new URL(resolution.download_url) } catch (error) {
      throw new ArkmePluginError('extension-icon-download-url-invalid', '扩展市场返回了无效头像下载地址', false, 502, { cause: error })
    }
    assertSafeArtifactUrl(url, 'download')
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET', headers: safeSignedHeaders(resolution.download_headers ?? {}), redirect: 'error', signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new ArkmePluginError('extension-icon-download-failed', `扩展头像下载返回 HTTP ${String(response.status)}`, true, 502)
      }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(declared) && declared > ARKME_EXTENSION_ICON_MAX_BYTES) {
        throw new ArkmePluginError('extension-icon-size-invalid', '扩展头像超过 2 MiB', false, 502)
      }
      const chunks: Uint8Array[] = []
      let total = 0
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        if (total > ARKME_EXTENSION_ICON_MAX_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new ArkmePluginError('extension-icon-size-invalid', '扩展头像超过 2 MiB', false, 502)
        }
        chunks.push(next.value)
      }
      const data = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
      return data
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('extension-icon-download-timeout', '扩展头像下载超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('extension-icon-download-failed', '无法下载扩展头像', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  async createPreviewUploadSession(input: {
    extension_id: string
    content_type: ArkmeExtensionPreviewMediaType
    preview_size: number
    preview_sha256: string
    idempotency_key: string
  }, signal?: AbortSignal): Promise<ArkmeExtensionPreviewUploadSession> {
    if (input.preview_size <= 0 || input.preview_size > ARKME_EXTENSION_PREVIEW_MAX_BYTES) {
      throw new ArkmePluginError('extension-preview-size-invalid', '扩展预览图必须小于 5 MiB', false, 400)
    }
    return await this.post('/api/v1/extensions/preview-upload-session/create', input, signal)
  }

  async uploadPreview(
    uploadUrl: string,
    data: Uint8Array,
    mediaType: ArkmeExtensionPreviewMediaType,
    uploadHeaders: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    if (data.byteLength <= 0 || data.byteLength > ARKME_EXTENSION_PREVIEW_MAX_BYTES) {
      throw new ArkmePluginError('extension-preview-size-invalid', '扩展预览图必须小于 5 MiB', false, 400)
    }
    let url: URL
    try { url = new URL(uploadUrl) } catch (error) {
      throw new ArkmePluginError('extension-preview-upload-url-invalid', '扩展市场返回了无效预览图上传地址', false, 502, { cause: error })
    }
    assertSafeArtifactUrl(url, 'upload')
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers = safeSignedHeaders(uploadHeaders)
      const response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          ...headers,
          ...Object.keys(headers).some(key => key.toLowerCase() === 'content-type') ? {} : { 'Content-Type': mediaType },
        },
        body: data as BodyInit,
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        throw new ArkmePluginError('extension-preview-upload-failed', `扩展预览图上传返回 HTTP ${String(response.status)}`, true, 502)
      }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('extension-preview-upload-timeout', '扩展预览图上传超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('extension-preview-upload-failed', '无法上传扩展预览图', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  async completePreviewUploadSession(previewUploadSessionId: string, signal?: AbortSignal): Promise<ArkmeExtensionPreviewGallery> {
    return await this.post('/api/v1/extensions/preview-upload-session/complete', {
      preview_upload_session_id: previewUploadSessionId,
    }, signal)
  }

  async deletePreview(
    extensionId: string,
    previewRef: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionPreviewGallery> {
    return await this.post('/api/v1/extensions/previews/delete', {
      extension_id: extensionId, preview_ref: previewRef, expected_revision: expectedRevision,
    }, signal)
  }

  async reorderPreviews(
    extensionId: string,
    orderedPreviewRefs: string[],
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionPreviewGallery> {
    return await this.post('/api/v1/extensions/previews/reorder', {
      extension_id: extensionId, ordered_preview_refs: orderedPreviewRefs, expected_revision: expectedRevision,
    }, signal)
  }

  async resolvePreview(extensionId: string, previewRef: string, signal?: AbortSignal): Promise<ArkmeExtensionPreviewResolution> {
    return await this.post('/api/v1/extensions/preview-resolve', {
      extension_id: extensionId, preview_ref: previewRef,
    }, signal)
  }

  async downloadPreview(
    resolution: ArkmeExtensionPreviewResolution,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let url: URL
    try { url = new URL(resolution.download_url) } catch (error) {
      throw new ArkmePluginError('extension-preview-download-url-invalid', '扩展市场返回了无效预览图下载地址', false, 502, { cause: error })
    }
    assertSafeArtifactUrl(url, 'download')
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET', headers: safeSignedHeaders(resolution.download_headers ?? {}), redirect: 'error', signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new ArkmePluginError('extension-preview-download-failed', `扩展预览图下载返回 HTTP ${String(response.status)}`, true, 502)
      }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(declared) && declared > ARKME_EXTENSION_PREVIEW_MAX_BYTES) {
        throw new ArkmePluginError('extension-preview-size-invalid', '扩展预览图超过 5 MiB', false, 502)
      }
      const chunks: Uint8Array[] = []
      let total = 0
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        if (total > ARKME_EXTENSION_PREVIEW_MAX_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new ArkmePluginError('extension-preview-size-invalid', '扩展预览图超过 5 MiB', false, 502)
        }
        chunks.push(next.value)
      }
      const data = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
      return data
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('extension-preview-download-timeout', '扩展预览图下载超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('extension-preview-download-failed', '无法下载扩展预览图', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  async resolveInstall(extensionId: string, version?: string, signal?: AbortSignal): Promise<ArkmeExtensionInstallResolution> {
    return await this.post('/api/v1/extensions/resolve-install', {
      extension_id: extensionId,
      ...(version === undefined || version.trim() === '' ? {} : { version: version.trim() }),
    }, signal)
  }

  async resolveUpdates(installed: readonly ArkmeInstalledExtension[], signal?: AbortSignal): Promise<ArkmeExtensionUpdateResolution[]> {
    const response = await this.post<
      { items: ArkmeExtensionUpdateResolution[] }
      | { updates: Array<{
        installed: { extension_id?: string; version?: string } | string
        latest?: { version?: string; permissions?: string[] } | string
        revoked?: boolean
        revocation_reason?: string
        permission_added?: string[]
      }> }
      | ArkmeExtensionUpdateResolution[]
    >(
      '/api/v1/extensions/resolve-updates',
      { installed: installed.map(item => ({
        extension_id: item.extensionId,
        version: item.installedVersion,
        artifact_sha256: item.artifactSha256,
        update_channel: item.updateChannel,
      })) },
      signal,
    )
    if (Array.isArray(response)) return response
    if ('items' in response) return response.items
    return response.updates.map(item => {
      const installedValue = typeof item.installed === 'string'
        ? { extension_id: '', version: item.installed }
        : item.installed
      const latestVersion = typeof item.latest === 'string' ? item.latest : item.latest?.version
      return {
        extension_id: installedValue.extension_id ?? '',
        installed_version: installedValue.version ?? '',
        ...(latestVersion === undefined ? {} : { latest_version: latestVersion }),
        update_available: latestVersion !== undefined && latestVersion !== installedValue.version,
        revoked: item.revoked === true,
        ...(item.revocation_reason === undefined ? {} : { revocation_reason: item.revocation_reason }),
        ...(item.permission_added === undefined ? {} : { permissions_added: item.permission_added }),
      }
    })
  }

  async downloadArtifact(
    artifactUrl: string,
    artifactHeaders: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
    onProgress?: (progress: ExtensionDownloadProgress) => void,
  ): Promise<Uint8Array> {
    let url: URL
    try { url = new URL(artifactUrl) } catch (error) {
      throw new ArkmePluginError('extension-download-url-invalid', '扩展市场返回了无效下载地址', false, 502, { cause: error })
    }
    assertSafeArtifactUrl(url, 'download')
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    let timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const refreshIdleTimeout = (): void => {
      clearTimeout(timeout)
      timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    }
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET', headers: safeSignedHeaders(artifactHeaders), redirect: 'error', signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new ArkmePluginError('extension-download-failed', `扩展制品下载返回 HTTP ${response.status}`, true, 502)
      }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(declared) && declared > ARKME_EXTENSION_MAX_BYTES) assertExtensionArtifactSize(declared)
      const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : undefined
      const chunks: Uint8Array[] = []
      let total = 0
      onProgress?.({ downloadedBytes: 0, ...(totalBytes === undefined ? {} : { totalBytes }) })
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        assertExtensionArtifactSize(total)
        chunks.push(next.value)
        refreshIdleTimeout()
        onProgress?.({ downloadedBytes: total, ...(totalBytes === undefined ? {} : { totalBytes }) })
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return bytes
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('extension-download-timeout', '扩展制品下载超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('extension-download-failed', '无法下载扩展制品', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}

function extensionMetadataError(error: unknown): unknown {
  if (!(error instanceof ArkmePluginError)) return error
  const mapped: Record<string, { code: string; message: string; retryable: boolean; httpStatus: number }> = {
    'arkme-code-40021': { code: 'extension-metadata-invalid', message: '扩展信息无效', retryable: false, httpStatus: 400 },
    'arkme-code-40321': { code: 'extension-metadata-owner-forbidden', message: '当前账号不能编辑该扩展', retryable: false, httpStatus: 403 },
    'arkme-code-40421': { code: 'extension-not-found', message: '扩展不存在', retryable: false, httpStatus: 404 },
    'arkme-code-40921': { code: 'extension-metadata-idempotency-conflict', message: '扩展信息保存请求冲突', retryable: false, httpStatus: 409 },
    'arkme-code-50321': { code: 'extension-metadata-update-failed', message: '扩展信息暂时无法保存', retryable: true, httpStatus: 503 },
  }
  const known = mapped[error.code]
  if (known !== undefined) {
    return new ArkmePluginError(known.code, known.message, known.retryable, known.httpStatus, { cause: error })
  }
  if (error.code === 'arkme-http-error' && error.upstreamStatus === 404) {
    return new ArkmePluginError(
      'extension-metadata-update-unsupported',
      '当前扩展服务尚未支持资料编辑',
      false,
      404,
      { cause: error },
    )
  }
  return error
}

function safeSignedHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.trim().toLowerCase()
    if (!/^[a-z0-9-]{1,64}$/.test(normalized)
      || ['authorization', 'cookie', 'host', 'proxy-authorization'].includes(normalized)
      || /[\r\n]/.test(value)) {
      throw new ArkmePluginError('extension-signed-header-invalid', '扩展市场返回了不安全的制品请求头', false, 502)
    }
    result[normalized] = value
  }
  return result
}

function assertSafeArtifactUrl(url: URL, operation: 'upload' | 'download'): void {
  const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if ((!localHttp && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    throw new ArkmePluginError(
      operation === 'upload' ? 'extension-upload-url-invalid' : 'extension-download-url-invalid',
      '扩展制品地址必须是无凭据 HTTPS URL 或 loopback HTTP URL',
      false,
      502,
    )
  }
}
