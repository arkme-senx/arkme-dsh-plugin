import { JOTMO_PROVIDER_CONTRACT_VERSION } from '../types.js'
import type {
  JotmoAuthSnapshot,
  JotmoCachedQueryResult,
  JotmoCachedSnapshot,
  JotmoCallDetail,
  JotmoCallList,
  JotmoCreateTextResult,
  JotmoImagePayload,
  JotmoPendingWrite,
  JotmoPluginErrorBody,
  JotmoPluginOperation,
  JotmoPluginResponse,
  JotmoProviderCapabilities,
  JotmoProviderState,
  JotmoSourceDirectory,
  JotmoSourceList,
  JotmoSourceSendResult,
  JotmoTimelineCursor,
  JotmoTimelinePage,
  JotmoUserProfileSnapshot,
} from '../types.js'

export type {
  JotmoAuthSnapshot,
  JotmoCachedQueryResult,
  JotmoCachedSnapshot,
  JotmoCallDetail,
  JotmoCallDirection,
  JotmoCallList,
  JotmoCallListItem,
  JotmoCallMediaType,
  JotmoCallParticipant,
  JotmoCallSectionState,
  JotmoCallTextSection,
  JotmoCallTranscriptItem,
  JotmoCallTranscriptSection,
  JotmoCreateTextResult,
  JotmoImageMediaType,
  JotmoImagePayload,
  JotmoPendingWrite,
  JotmoProviderCapabilities,
  JotmoProviderState,
  JotmoSourceDirectory,
  JotmoSourceItem,
  JotmoSourceKind,
  JotmoSourceList,
  JotmoSourceSendResult,
  JotmoTimelineCursor,
  JotmoTimelineItem,
  JotmoTimelinePage,
  JotmoUserProfile,
  JotmoUserProfileSnapshot,
  JotmoSelfRecordItem,
  JotmoSelfRecordList,
  JotmoSelfSummary,
} from '../types.js'
export { JOTMO_PROVIDER_CONTRACT_VERSION } from '../types.js'

const DEFAULT_ROUTE = '/jotmo-self/api'

export class JotmoClientError extends Error {
  constructor(readonly body: JotmoPluginErrorBody) {
    super(body.message)
    this.name = 'JotmoClientError'
  }
}

export interface JotmoSdkOptions {
  route?: string
  fetchImpl?: typeof fetch
}

export interface JotmoSearchOptions {
  limit?: number
  beforeMillis?: number
  syncAll?: boolean
}

export interface JotmoSubscribeOptions {
  intervalMs?: number
  immediate?: boolean
  onError?: (error: unknown) => void
}

export class JotmoSdk {
  private readonly route: string
  private readonly fetchImpl: typeof fetch

  constructor(options: JotmoSdkOptions = {}) {
    const route = options.route ?? DEFAULT_ROUTE
    if (!/^\/[A-Za-z0-9/_-]+$/.test(route) || route.startsWith('//')) {
      throw new TypeError('Jotmo SDK route must be a same-origin absolute path')
    }
    this.route = route
    // Browser fetch is a Web IDL method whose receiver must remain the global object.
    // Storing it unbound and later calling this.fetchImpl(...) makes the SDK instance
    // the receiver and Chrome rejects the call with "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async capabilities(signal?: AbortSignal): Promise<JotmoProviderCapabilities> {
    const capabilities = await this.call<JotmoProviderCapabilities>('provider.capabilities', undefined, signal)
    if (capabilities.contractVersion !== JOTMO_PROVIDER_CONTRACT_VERSION) {
      throw new Error(`Unsupported Jotmo provider contract version ${String(capabilities.contractVersion)}`)
    }
    return capabilities
  }

  async state(signal?: AbortSignal): Promise<JotmoProviderState> {
    return await this.call<JotmoProviderState>('provider.state', undefined, signal)
  }

  async authStatus(signal?: AbortSignal): Promise<JotmoAuthSnapshot> {
    return await this.call<JotmoAuthSnapshot>('auth.status', undefined, signal)
  }

  async profile(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<JotmoUserProfileSnapshot> {
    return await this.call<JotmoUserProfileSnapshot>(
      options.refresh === true ? 'user.profile.refresh' : 'user.profile',
      undefined,
      options.signal,
    )
  }

  /** Read one current-user Jiwo image through the authenticated Provider without exposing a signed OSS URL. */
  async readImage(imageRef: string, signal?: AbortSignal): Promise<JotmoImagePayload> {
    if (imageRef.trim() === '') throw new TypeError('Jiwo image reference must not be empty')
    return await this.call<JotmoImagePayload>('image.read', { imageRef }, signal)
  }

  /** Convert a Provider image payload into a browser-renderable data URL. */
  imageDataUrl(image: JotmoImagePayload): string {
    return `data:${image.mediaType};base64,${image.dataBase64}`
  }

  async listSources(
    directory: JotmoSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<JotmoSourceList> {
    return await this.call<JotmoSourceList>('sources.list', {
      directory,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async listCalls(options: {
    limit?: number
    cursor?: string
    signal?: AbortSignal
  } = {}): Promise<JotmoCallList> {
    return await this.call<JotmoCallList>('calls.list', {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async readCall(callRef: string, options: { signal?: AbortSignal } = {}): Promise<JotmoCallDetail> {
    if (callRef.trim() === '') throw new TypeError('Jiwo call reference must not be empty')
    return await this.call<JotmoCallDetail>('calls.detail', { callRef }, options.signal)
  }

  async readSource(
    sourceRef: string,
    options: { limit?: number; cursor?: JotmoTimelineCursor; signal?: AbortSignal } = {},
  ): Promise<JotmoTimelinePage> {
    if (sourceRef.trim() === '') throw new TypeError('Jiwo source reference must not be empty')
    return await this.call<JotmoTimelinePage>('source.timeline', {
      sourceRef,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async sendText(
    sourceRef: string,
    textContent: string,
    options: { recordUid?: string; relationUid?: string; signal?: AbortSignal } = {},
  ): Promise<JotmoSourceSendResult> {
    if (sourceRef.trim() === '' || textContent.trim() === '') {
      throw new TypeError('Jiwo source reference and text must not be empty')
    }
    return await this.call<JotmoSourceSendResult>('source.send-text', {
      sourceRef,
      textContent,
      recordUid: options.recordUid ?? crypto.randomUUID(),
      relationUid: options.relationUid ?? crypto.randomUUID(),
    }, options.signal)
  }

  async snapshot(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<JotmoCachedSnapshot> {
    return await this.call<JotmoCachedSnapshot>(
      options.refresh === true ? 'records.refresh' : 'records.cache',
      undefined,
      options.signal,
    )
  }

  async search(query: string, options: JotmoSearchOptions & { signal?: AbortSignal } = {}): Promise<JotmoCachedQueryResult> {
    return await this.call<JotmoCachedQueryResult>('records.search', {
      query,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.beforeMillis === undefined ? {} : { beforeMillis: options.beforeMillis }),
      ...(options.syncAll === undefined ? {} : { syncAll: options.syncAll }),
    }, options.signal)
  }

  async createText(
    textContent: string,
    options: { recordUid?: string; signal?: AbortSignal } = {},
  ): Promise<JotmoCreateTextResult> {
    return await this.call<JotmoCreateTextResult>('records.create', {
      recordUid: options.recordUid ?? crypto.randomUUID(),
      textContent,
    }, options.signal)
  }

  async outbox(signal?: AbortSignal): Promise<JotmoPendingWrite[]> {
    return await this.call<JotmoPendingWrite[]>('records.outbox', undefined, signal)
  }

  async retry(recordUid: string, signal?: AbortSignal): Promise<JotmoCreateTextResult> {
    return await this.call<JotmoCreateTextResult>('records.retry', { recordUid }, signal)
  }

  subscribe(listener: (state: JotmoProviderState) => void, options: JotmoSubscribeOptions = {}): () => void {
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
    operation: JotmoPluginOperation,
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
    let body: JotmoPluginResponse<T>
    try {
      body = await response.json() as JotmoPluginResponse<T>
    } catch {
      throw new JotmoClientError({
        code: 'local-response-invalid',
        message: '即我插件返回了无效响应',
        retryable: true,
      })
    }
    if (!body.ok) throw new JotmoClientError(body.error)
    return body.value
  }
}

export function createJotmoSdk(options?: JotmoSdkOptions): JotmoSdk {
  return new JotmoSdk(options)
}

const defaultSdk = createJotmoSdk()

export async function callJotmo<T>(
  operation: JotmoPluginOperation,
  params?: Record<string, unknown>,
): Promise<T> {
  return await defaultSdk.call<T>(operation, params)
}
