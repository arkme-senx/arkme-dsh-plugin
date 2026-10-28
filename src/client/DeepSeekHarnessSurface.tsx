import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ARKME_HARNESS_EMBED_PATH, HARNESS_SESSION_NAVIGATION_KEY, type HarnessSessionWindow } from '../harness-embed-contract.js'
import { HARNESS_HISTORY_PREVIEW, HARNESS_NATIVE_OPEN, type HarnessHistoryPreviewRequest, type NativeSessionRequest } from './harness-native-navigation.js'
import { HARNESS_LOCAL_SESSION_OPEN } from './harness-session-menu-bridge.js'
import { conversationMenuLayer } from './conversation-menu-layer.js'
import { watchHarnessSurfaceViewport } from './harness-surface-viewport.js'
import { watchHarnessWindowDrag } from './harness-window-drag.js'
import { arkmeTheme } from './arkme-theme.js'

export const DEEPSEEK_HARNESS_EMBED_QUERY = 'arkme-harness-embed'
export const DEEPSEEK_HARNESS_NATIVE_SETTINGS_QUERY = 'arkme-harness-native-settings'

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: arkmeTheme.base, position: 'absolute', inset: 0,
  },
  frame: {
    width: '100%', height: '100%', border: 0, display: 'block', background: 'transparent', colorScheme: 'inherit',
  },
}

export function deepSeekHarnessEmbedRequested(search?: string): boolean {
  const resolvedSearch = search ?? (typeof window === 'undefined' ? '' : window.location?.search ?? '')
  return new URLSearchParams(resolvedSearch).get(DEEPSEEK_HARNESS_EMBED_QUERY) === '1'
}

export function deepSeekHarnessNativeSettingsRequested(search?: string): boolean {
  const resolvedSearch = search ?? (typeof window === 'undefined' ? '' : window.location?.search ?? '')
  return new URLSearchParams(resolvedSearch).get(DEEPSEEK_HARNESS_NATIVE_SETTINGS_QUERY) === '1'
}

export function deepSeekHarnessEmbedUrl(nativeSettings = false): string {
  return `${ARKME_HARNESS_EMBED_PATH}?${DEEPSEEK_HARNESS_EMBED_QUERY}=1${nativeSettings ? `&${DEEPSEEK_HARNESS_NATIVE_SETTINGS_QUERY}=1` : ''}`
}

/**
 * Same-origin core-only DSH client embedded inside Arkme's existing conversation region.
 *
 * It stays mounted while another Arkme conversation is visible so the native client can
 * finish its own core boot independently of the Arkme directory request lifecycle.
 */
type SurfaceProps = { visible?: boolean; nativeSettings?: boolean; accountId?: number | undefined; accountScope?: string | undefined; followSession?: boolean }

export function DeepSeekHarnessSurface(props: SurfaceProps) {
  return <NativeAccountSurface key={`${props.accountId}:${props.accountScope}`} {...props} />
}

function NativeAccountSurface(props: SurfaceProps) {
  const [preview, setPreview] = useState<HarnessHistoryPreviewRequest['session']>()
  const [source, setSource] = useState<NativeSessionRequest>({ runtimeRef: '', sessionRef: '' })
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    const open = (event: Event) => {
      const request = (event as CustomEvent<NativeSessionRequest>).detail
      if (request.accountId !== String(props.accountId ?? '') || request.accountScope !== (props.accountScope ?? '')) return
      setPreview(undefined)
      setSource(previous => ({ ...request, revision: (previous.revision ?? 0) + 1 }))
    }
    const showPreview = (event: Event) => {
      const request = (event as CustomEvent<HarnessHistoryPreviewRequest>).detail
      if (request.accountId !== String(props.accountId ?? '') || request.accountScope !== (props.accountScope ?? '')) return
      setPreview(request.session)
    }
    document.addEventListener(HARNESS_NATIVE_OPEN, open)
    document.addEventListener(HARNESS_HISTORY_PREVIEW, showPreview)
    return () => { document.removeEventListener(HARNESS_NATIVE_OPEN, open); document.removeEventListener(HARNESS_HISTORY_PREVIEW, showPreview) }
  }, [props.accountId, props.accountScope])
  const clearHistory = useCallback(() => setPreview(undefined), [])
  const historyId = preview ? `arkme:${encodeURIComponent(preview.runtimeRef)}:${encodeURIComponent(preview.sessionRef)}` : undefined
  return <><NativeSurface {...props} source={source} historyId={historyId} onLocalOpen={clearHistory} />
  </>
}

/** One document per account. Selection never changes the page URL or boot graph. */
function NativeSurface({ visible = true, nativeSettings = false, accountId, accountScope, followSession = true, source, historyId, onLocalOpen }: SurfaceProps & { source: NativeSessionRequest; historyId?: string | undefined; onLocalOpen(): void }) {
  const [url] = useState(() => deepSeekHarnessEmbedUrl(nativeSettings))
  const [loaded, setLoaded] = useState(false)
  const seatRef = useRef<HTMLSpanElement>(null)
  const surfaceRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const floating = typeof document !== 'undefined' && accountId !== undefined
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let native: Document | null | undefined
    const attach = () => { native?.removeEventListener(HARNESS_LOCAL_SESSION_OPEN, onLocalOpen); native = frame.contentDocument; native?.addEventListener(HARNESS_LOCAL_SESSION_OPEN, onLocalOpen) }
    frame.addEventListener('load', attach); attach()
    return () => { frame.removeEventListener('load', attach); native?.removeEventListener(HARNESS_LOCAL_SESSION_OPEN, onLocalOpen) }
  }, [onLocalOpen])
  useLayoutEffect(() => {
    if (surfaceRef.current && frameRef.current) return watchHarnessWindowDrag(surfaceRef.current, frameRef.current)
  }, [floating])
  useLayoutEffect(() => {
    if (floating && seatRef.current && surfaceRef.current && frameRef.current) {
      return watchHarnessSurfaceViewport(surfaceRef.current, frameRef.current, seatRef.current)
    }
  }, [floating])
  const content = <section
    ref={surfaceRef}
    data-arkme-owned="deepseek-harness-surface"
    data-arkme-preload="true"
    data-arkme-active="true"
    data-arkme-runtime=""
    data-arkme-open-session={source.runtimeRef ? `arkme:${encodeURIComponent(source.runtimeRef)}:${encodeURIComponent(source.sessionRef)}` : source.sessionRef}
    data-arkme-open-revision={source.revision ?? 0}
    data-arkme-history-session={historyId}
    data-arkme-account-id={accountId}
    data-arkme-account-scope={accountScope}
    data-arkme-follow-session={visible && !historyId && followSession && accountId !== undefined ? 'true' : 'false'}
    data-arkme-visible={visible ? 'true' : 'false'}
    style={{
      ...styles.root,
      ...(floating ? { position: 'fixed' as const, background: 'transparent', clipPath: 'inset(100%)' } : {}),
      visibility: visible ? 'visible' : 'hidden',
      pointerEvents: visible ? 'auto' : 'none',
      zIndex: visible ? 1 : 0,
    }}
    aria-hidden={visible ? undefined : true}
    aria-label="DeepSeek Harness"
  >
    <iframe
      key={`${accountId}:${accountScope}`}
      ref={frameRef}
      title="DeepSeek Harness"
      src={url}
      style={{ ...styles.frame, visibility: loaded ? 'inherit' : 'hidden' }}
      onLoad={() => setLoaded(true)}
      loading="eager"
      allow="clipboard-read; clipboard-write; microphone"
    />
  </section>
  return floating ? <>
    <span ref={seatRef} data-arkme-harness-seat aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    {createPortal(content, conversationMenuLayer(document))}
  </> : content
}

/** Open in the visible native client's session owner, preserving errors for search. */
export function openEmbeddedDshSession(sessionId: string): void {
  const frame = document.querySelector<HTMLIFrameElement>('[data-arkme-owned="deepseek-harness-surface"][data-arkme-runtime=""] iframe')
  const navigation = (frame?.contentWindow as HarnessSessionWindow | null)?.[HARNESS_SESSION_NAVIGATION_KEY]
  if (typeof navigation?.open !== 'function') throw new Error('DSH 对话尚未就绪，请稍后重试')
  navigation.open(sessionId)
}

/** Missing is reported only after a successful authoritative list refresh. */
export async function hasEmbeddedDshSession(sessionId: string): Promise<boolean> {
  const frame = document.querySelector<HTMLIFrameElement>('[data-arkme-owned="deepseek-harness-surface"][data-arkme-runtime=""] iframe')
  const navigation = (frame?.contentWindow as HarnessSessionWindow | null)?.[HARNESS_SESSION_NAVIGATION_KEY]
  if (typeof navigation?.has !== 'function') throw new Error('DSH 对话尚未就绪，请稍后重试')
  return await navigation.has(sessionId)
}
