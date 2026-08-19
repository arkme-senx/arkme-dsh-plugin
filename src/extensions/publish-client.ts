import { ArkmePluginError } from '../arkme-service.js'
import { ARKME_EXTENSION_MAX_BYTES, type ArkmeExtensionArtifact, type ArkmeExtensionCatalogItem,
  type ArkmeExtensionCatalogPage, type ArkmeExtensionDeleteResult, type ArkmeExtensionInstallResolution, type ArkmeExtensionPublishResult,
  type ArkmeExtensionPublishSession, type ArkmeExtensionUpdateResolution, type ArkmeExtensionVisibility,
  type ArkmeInstalledExtension,
} from './types.js'
import { assertExtensionArtifactSize } from './artifact.js'

export type ExtensionAuthenticatedPost = <T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<T>

export interface ExtensionDownloadProgress {
  downloadedBytes: number
  totalBytes?: number
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

  async completePublishSession(publishSessionId: string, signal?: AbortSignal): Promise<ArkmeExtensionPublishResult> {
    return await this.post('/api/v1/extensions/publish-session/complete', {
      publish_session_id: publishSessionId,
    }, signal)
  }

  async publishStatus(publishSessionId: string, signal?: AbortSignal): Promise<ArkmeExtensionPublishResult> {
    return await this.post('/api/v1/extensions/publish-session/status', {
      publish_session_id: publishSessionId,
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
    if (!('extension' in response)) return response
    const latest = response.latest_version
    return {
      ...response.extension,
      ...(typeof latest === 'string' ? { latest_stable_version: latest } : {}),
      ...(latest !== null && typeof latest === 'object' && typeof latest.version === 'string'
        ? { latest_stable_version: latest.version, version: latest.version, ...(latest.manifest === undefined ? {} : { manifest: latest.manifest }) }
        : {}),
    }
  }

  async versions(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.post('/api/public/v1/extensions/version-list', { extension_id: extensionId }, signal)
  }

  async myList(input: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    return await this.post('/api/v1/extensions/my-list', input, signal)
  }

  async deleteExtension(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionDeleteResult> {
    return await this.post('/api/v1/extensions/delete', { extension_id: extensionId }, signal)
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
