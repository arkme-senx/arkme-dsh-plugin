import { readBoundedResponse } from './bounded-response.js'
import type { OpenApiMcpManifest, OpenApiMcpManifestSource } from './types.js'

const CATALOG_REVISION = /^sha256:[0-9a-f]{64}$/
const RUNTIME_REVISION = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ENDPOINT_PATH = /^\/mcp\/[A-Za-z0-9/_-]+$/

export type OpenApiMcpManifestFailureKind = 'transient' | 'contract'

export class OpenApiMcpManifestError extends Error {
  constructor(readonly kind: OpenApiMcpManifestFailureKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OpenApiMcpManifestError'
  }
}

interface Envelope { code?: unknown; data?: unknown }

export class HttpOpenApiMcpManifestSource implements OpenApiMcpManifestSource {
  private readonly manifestUrl: string

  constructor(baseUrl: string, private readonly fetchImpl: typeof fetch, private readonly timeoutMs: number) {
    this.manifestUrl = `${baseUrl.replace(/\/+$/, '')}/api/public/v1/mcp/manifest`
  }

  async read(signal: AbortSignal): Promise<OpenApiMcpManifest> {
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
    let response: Response
    try {
      response = await this.fetchImpl(this.manifestUrl, {
        method: 'GET', headers: { Accept: 'application/json' }, signal: combinedSignal,
      })
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw new OpenApiMcpManifestError('transient', 'OpenAPI MCP 服务清单暂时不可用', { cause: error })
    }
    if (!response.ok) throw new OpenApiMcpManifestError('transient', 'OpenAPI MCP 服务清单暂时不可用')
    let raw: string
    try { raw = await readBoundedResponse(response) } catch (error) {
      throw new OpenApiMcpManifestError('contract', 'OpenAPI MCP 服务清单超出限制', { cause: error })
    }
    let envelope: Envelope
    try { envelope = JSON.parse(raw) as Envelope } catch (error) {
      throw new OpenApiMcpManifestError('contract', 'OpenAPI MCP 服务清单不是有效 JSON', { cause: error })
    }
    if (envelope.code !== 200) throw new OpenApiMcpManifestError('transient', 'OpenAPI MCP 服务清单未成功返回')
    return parseManifest(envelope.data)
  }
}

function parseManifest(value: unknown): OpenApiMcpManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenApiMcpManifestError('contract', 'OpenAPI MCP 服务清单无效')
  }
  const record = value as Record<string, unknown>
  const fields = new Set(['catalog_revision', 'runtime_revision', 'endpoint_path', 'poll_after_seconds'])
  if (Object.keys(record).some(key => !fields.has(key))
    || typeof record.catalog_revision !== 'string' || !CATALOG_REVISION.test(record.catalog_revision)
    || typeof record.runtime_revision !== 'string' || !RUNTIME_REVISION.test(record.runtime_revision)
    || typeof record.endpoint_path !== 'string' || !ENDPOINT_PATH.test(record.endpoint_path)
    || record.endpoint_path.includes('//')
    || !Number.isSafeInteger(record.poll_after_seconds)
    || (record.poll_after_seconds as number) < 60
    || (record.poll_after_seconds as number) > 60 * 60) {
    throw new OpenApiMcpManifestError('contract', 'OpenAPI MCP 服务清单合同无效')
  }
  return {
    catalogRevision: record.catalog_revision,
    runtimeRevision: record.runtime_revision,
    endpointPath: record.endpoint_path,
    pollAfterSeconds: record.poll_after_seconds as number,
  }
}
