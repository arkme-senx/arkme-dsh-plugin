import { parseShareLink, previewObject, projectSharePreview, sharePreviewIsOwnMessage, type ShareLinkPreview, type ShareLinkTarget } from '../share-link-preview.js'
import type { ServiceRuntime } from './service.js'

const MAX_BYTES = 2 * 1024 * 1024
type ReadRoute = { base: string; path: string; body: Record<string, unknown> }
type ReadResult = { data: unknown } | { state: ShareLinkPreview['state'] }

/** Bounded snapshot reads. Never hydrate replies, load source history, or mark views. */
export class SharePreviewService {
  constructor(private readonly runtime: ServiceRuntime) {}

  private route(target: ShareLinkTarget): ReadRoute | undefined {
    const c = this.runtime.config
    switch (target.kind) {
      case 'message': return { base: c.chatBaseUrl, path: '/api/public/v1/chats/messages/copy-link/detail', body: { sid: target.id } }
      case 'conversation': return { base: c.chatBaseUrl, path: '/api/public/v1/chats/records/forward/share/detail', body: { share_id: target.id, code: target.code ?? '', s: target.stamp ?? 0 } }
      case 'world': return { base: c.authBaseUrl, path: '/api/public/v1/auth/get-public-user-by-jotmo-ids', body: { jotmo_ids: [target.id] } }
      case 'public-record': return { base: c.worldBaseUrl, path: '/api/public/v1/public-record/detail', body: { record_uid: target.id } }
      case 'topic': return { base: c.subjectBaseUrl, path: '/api/public/v1/subject/preview-remote-subject', body: { ob_remote_subject: target.id, code: target.code ?? '', stamp: target.stamp ?? 0 } }
      case 'call-invite': return target.id ? { base: c.webrtcBaseUrl, path: '/api/public/v1/trtc/share-call-link/resolve', body: { token: target.id } } : undefined
      case 'voiceprint': return target.id ? { base: c.audioBaseUrl, path: '/api/public/v1/audio/voiceprint/invites/preview', body: { preview_token: target.id } } : undefined
      case 'extension': return c.extensionPublishBaseUrl ? { base: c.extensionPublishBaseUrl, path: '/api/public/v1/extensions/share/detail', body: { share_ref: target.id } } : undefined
      // Call detail records viewers. Photo service has no configured public base in this plugin.
      default: return undefined
    }
  }

  private async read(route: ReadRoute, signal: AbortSignal, accessToken?: string): Promise<ReadResult> {
    const response = await this.runtime.fetchImpl(`${route.base.replace(/\/$/u, '')}${route.path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Usersource: '3', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(route.body), signal, redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel()
      return { state: response.status === 401 || response.status === 403 ? 'restricted' : response.status === 404 ? 'unavailable' : response.status === 410 ? 'expired' : 'error' }
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); return { state: 'error' } }
    const reader = response.body?.getReader()
    if (!reader) return { state: 'error' }
    let text = '', size = 0
    const decoder = new TextDecoder()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_BYTES) { await reader.cancel(); return { state: 'error' } }
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
    } finally { reader.releaseLock() }
    const envelope = previewObject(JSON.parse(text))
    if (envelope.code !== 200) return { state: envelope.code === 401 || envelope.code === 403 ? 'restricted' : envelope.code === 404 ? 'unavailable' : envelope.code === 410 ? 'expired' : 'error' }
    return { data: envelope.data }
  }

  async resolve(rawUrl: string, signal?: AbortSignal): Promise<ShareLinkPreview | null> {
    const target = parseShareLink(rawUrl)
    if (!target) return null
    const fallback: ShareLinkPreview = { kind: target.kind, state: 'generic' }
    // A test share must never be resolved against a production tenant, or vice versa.
    if (target.environment !== this.runtime.config.environment) return fallback
    const route = this.route(target)
    if (!route) return fallback
    const session = await this.runtime.accountScopedSession()
    if (!session) return { ...fallback, state: 'restricted' }
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    // Account subscriptions synchronously announce their current scope. Only
    // subsequent announcements represent a change that invalidates this read.
    let subscribed = false
    const unsubscribe = this.runtime.subscribeAccountScope(() => { if (subscribed) abort() })
    subscribed = true
    const timer = setTimeout(abort, Math.min(8000, this.runtime.config.requestTimeoutMs))
    try {
      // Existing authenticated resolve adds authorized source anchors. Read only
      // that envelope, never the UI detail flow that also fetches extensions/media.
      const useIdentity = target.kind === 'message' && Boolean(session.accessToken)
      let result = await this.read(useIdentity ? { ...route, path: '/api/v1/chats/messages/copy-link/resolve' } : route,
        controller.signal, useIdentity ? session.accessToken : undefined)
      // Public snapshot remains useful if the existing login token has expired.
      if (useIdentity && 'state' in result && result.state === 'restricted' && !controller.signal.aborted) {
        result = await this.read(route, controller.signal)
      }
      const current = await this.runtime.accountScopedSession()
      if (controller.signal.aborted || current?.userId !== session.userId || current.refreshToken !== session.refreshToken) return null
      if ('state' in result) return { ...fallback, state: result.state }
      const preview = projectSharePreview(target, result.data)
      return { ...preview, ...(useIdentity && preview.state === 'ready' && preview.kind !== 'conversation'
        && sharePreviewIsOwnMessage(result.data, session.userId) ? { authorIsMe: true } : {}) }
    } catch {
      // Do not leak invitation credentials or signed URLs into logs/errors.
      return signal?.aborted ? null : { ...fallback, state: 'error' }
    } finally { clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort) }
  }
}
