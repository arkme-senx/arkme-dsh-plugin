import { ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'
import type {
  ArkmeAuthSnapshot,
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeCreateTextResult,
  ArkmeImagePayload,
  ArkmePendingWrite,
  ArkmePluginErrorBody,
  ArkmePluginOperation,
  ArkmePluginResponse,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmeSourceDirectory,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelinePage,
  ArkmeUserProfileSnapshot,
} from '../types.js'

export type {
  ArkmeAuthSnapshot,
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeCreateTextResult,
  ArkmeImageMediaType,
  ArkmeImagePayload,
  ArkmePendingWrite,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceKind,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
  ArkmeTimelinePage,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
} from '../types.js'
export { ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'

const DEFAULT_ROUTE = '/arkme-self/api'

export class ArkmeClientError extends Error {
  constructor(readonly body: ArkmePluginErrorBody) {
    super(body.message)
    this.name = 'ArkmeClientError'
  }
}

export interface ArkmeSdkOptions {
  route?: string
  fetchImpl?: typeof fetch
}

export interface ArkmeSearchOptions {
  limit?: number
  beforeMillis?: number
  syncAll?: boolean
}

export interface ArkmeSubscribeOptions {
  intervalMs?: number
  immediate?: boolean
  onError?: (error: unknown) => void
}

export class ArkmeSdk {
  private readonly route: string
  private readonly fetchImpl: typeof fetch

  constructor(options: ArkmeSdkOptions = {}) {
    const route = options.route ?? DEFAULT_ROUTE
    if (!/^\/[A-Za-z0-9/_-]+$/.test(route) || route.startsWith('//')) {
      throw new TypeError('Arkme SDK route must be a same-origin absolute path')
    }
    this.route = route
    // Browser fetch is a Web IDL method whose receiver must remain the global object.
    // Storing it unbound and later calling this.fetchImpl(...) makes the SDK instance
    // the receiver and Chrome rejects the call with "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async capabilities(signal?: AbortSignal): Promise<ArkmeProviderCapabilities> {
    const capabilities = await this.call<ArkmeProviderCapabilities>('provider.capabilities', undefined, signal)
    if (capabilities.contractVersion !== ARKME_PROVIDER_CONTRACT_VERSION) {
      throw new Error(`Unsupported Arkme provider contract version ${String(capabilities.contractVersion)}`)
    }
    return capabilities
  }

  async state(signal?: AbortSignal): Promise<ArkmeProviderState> {
    return await this.call<ArkmeProviderState>('provider.state', undefined, signal)
  }

  async authStatus(signal?: AbortSignal): Promise<ArkmeAuthSnapshot> {
    return await this.call<ArkmeAuthSnapshot>('auth.status', undefined, signal)
  }

  async profile(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeUserProfileSnapshot> {
    return await this.call<ArkmeUserProfileSnapshot>(
      options.refresh === true ? 'user.profile.refresh' : 'user.profile',
      undefined,
      options.signal,
    )
  }

  /** Read one current-user Arkme image through the authenticated Provider without exposing a signed OSS URL. */
  async readImage(imageRef: string, signal?: AbortSignal): Promise<ArkmeImagePayload> {
    if (imageRef.trim() === '') throw new TypeError('Arkme image reference must not be empty')
    return await this.call<ArkmeImagePayload>('image.read', { imageRef }, signal)
  }

  /** Convert a Provider image payload into a browser-renderable data URL. */
  imageDataUrl(image: ArkmeImagePayload): string {
    return `data:${image.mediaType};base64,${image.dataBase64}`
  }

  async listSources(
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceList> {
    return await this.call<ArkmeSourceList>('sources.list', {
      directory,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async readSource(
    sourceRef: string,
    options: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal } = {},
  ): Promise<ArkmeTimelinePage> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme source reference must not be empty')
    return await this.call<ArkmeTimelinePage>('source.timeline', {
      sourceRef,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async sendText(
    sourceRef: string,
    textContent: string,
    options: { recordUid?: string; relationUid?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceSendResult> {
    if (sourceRef.trim() === '' || textContent.trim() === '') {
      throw new TypeError('Arkme source reference and text must not be empty')
    }
    return await this.call<ArkmeSourceSendResult>('source.send-text', {
      sourceRef,
      textContent,
      recordUid: options.recordUid ?? crypto.randomUUID(),
      relationUid: options.relationUid ?? crypto.randomUUID(),
    }, options.signal)
  }

  async snapshot(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeCachedSnapshot> {
    return await this.call<ArkmeCachedSnapshot>(
      options.refresh === true ? 'records.refresh' : 'records.cache',
      undefined,
      options.signal,
    )
  }

  async search(query: string, options: ArkmeSearchOptions & { signal?: AbortSignal } = {}): Promise<ArkmeCachedQueryResult> {
    return await this.call<ArkmeCachedQueryResult>('records.search', {
      query,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.beforeMillis === undefined ? {} : { beforeMillis: options.beforeMillis }),
      ...(options.syncAll === undefined ? {} : { syncAll: options.syncAll }),
    }, options.signal)
  }

  async createText(
    textContent: string,
    options: { recordUid?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeCreateTextResult> {
    return await this.call<ArkmeCreateTextResult>('records.create', {
      recordUid: options.recordUid ?? crypto.randomUUID(),
      textContent,
    }, options.signal)
  }

  async outbox(signal?: AbortSignal): Promise<ArkmePendingWrite[]> {
    return await this.call<ArkmePendingWrite[]>('records.outbox', undefined, signal)
  }

  async retry(recordUid: string, signal?: AbortSignal): Promise<ArkmeCreateTextResult> {
    return await this.call<ArkmeCreateTextResult>('records.retry', { recordUid }, signal)
  }

  subscribe(listener: (state: ArkmeProviderState) => void, options: ArkmeSubscribeOptions = {}): () => void {
    const intervalMs = Math.min(60_000, Math.max(500, Math.trunc(options.intervalMs ?? 1_000)))
    let stopped = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let previousKey = ''
    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const state = await this.state()
        if (stopped) return
        const key = `${state.authStatus}:${String(state.userId ?? '')}:${String(state.revision)}`
        if (key !== previousKey) {
          previousKey = key
          listener(state)
        }
      } catch (error) {
        options.onError?.(error)
      } finally {
        if (!stopped) timeout = setTimeout(() => { void poll() }, intervalMs)
      }
    }
    if (options.immediate === false) timeout = setTimeout(() => { void poll() }, intervalMs)
    else void poll()
    return () => {
      stopped = true
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  async call<T>(
    operation: ArkmePluginOperation,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetchImpl(this.route, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, ...(params === undefined ? {} : { params }) }),
      ...(signal === undefined ? {} : { signal }),
    })
    let body: ArkmePluginResponse<T>
    try {
      body = await response.json() as ArkmePluginResponse<T>
    } catch {
      throw new ArkmeClientError({
        code: 'local-response-invalid',
        message: 'Arkme 插件返回了无效响应',
        retryable: true,
      })
    }
    if (!body.ok) throw new ArkmeClientError(body.error)
    return body.value
  }
}

export function createArkmeSdk(options?: ArkmeSdkOptions): ArkmeSdk {
  return new ArkmeSdk(options)
}

const defaultSdk = createArkmeSdk()

export async function callArkme<T>(
  operation: ArkmePluginOperation,
  params?: Record<string, unknown>,
): Promise<T> {
  return await defaultSdk.call<T>(operation, params)
}
