import { useEffect, useRef, type CSSProperties } from 'react'
import { ARKME_HARNESS_EMBED_PATH } from '../harness-embed-contract.js'
import {
  applyQQ2006HarnessSkinToFrame,
  qq2006HarnessSkinSelected,
  subscribeQQ2006HarnessSkin,
} from './qq2006-harness-skin.js'

export const DEEPSEEK_HARNESS_EMBED_QUERY = 'arkme-harness-embed'
export const DEEPSEEK_HARNESS_NATIVE_SETTINGS_QUERY = 'arkme-harness-native-settings'
export const QQ2006_HARNESS_DISCOVERY_PATH = '/arkme-self/api/qq2006-harness'
const QQ2006_HARNESS_RETRY_MS = 2_000

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%', height: '100%', minWidth: 0, minHeight: 0,
    overflow: 'hidden', background: '#fff', position: 'absolute', inset: 0,
  },
  frame: {
    width: '100%', height: '100%', border: 0, display: 'block', background: '#fff',
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

/** Resolve the locally built source-integrated QQ2006 Harness when it is ready. */
export async function resolveQQ2006HarnessEmbedUrl(
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(QQ2006_HARNESS_DISCOVERY_PATH)
    if (!response.ok) return undefined
    const value = await response.json() as { ready?: unknown; url?: unknown }
    if (value.ready !== true || typeof value.url !== 'string') return undefined
    const url = new URL(value.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

/**
 * Same-origin core-only DSH client embedded inside Arkme's existing conversation region.
 *
 * It stays mounted while another Arkme conversation is visible so the native client can
 * finish its own core boot independently of the Arkme directory request lifecycle.
 */
export function DeepSeekHarnessSurface({ visible = true, nativeSettings = false }: { visible?: boolean; nativeSettings?: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const retryRef = useRef<number | undefined>(undefined)
  const syncVersionRef = useRef(0)
  const syncSkin = () => {
    const frame = frameRef.current
    if (frame === null) return
    const selected = qq2006HarnessSkinSelected()
    const syncVersion = ++syncVersionRef.current
    if (retryRef.current !== undefined) window.clearTimeout(retryRef.current)
    retryRef.current = undefined

    void resolveQQ2006HarnessEmbedUrl().then(url => {
      if (syncVersionRef.current !== syncVersion) return
      // Configuring the source-integrated runtime is an explicit opt-in. Prefer it even
      // before the optional marketplace bridge has finished hydrating its selected skin.
      if (url !== undefined) {
        if (frame.dataset.arkmeHarnessSource !== 'qq2006') {
          frame.dataset.arkmeHarnessSource = 'qq2006'
          frame.src = url
        }
        return
      }
      if (selected) {
        applyQQ2006HarnessSkinToFrame(frame, true)
        retryRef.current = window.setTimeout(syncSkin, QQ2006_HARNESS_RETRY_MS)
        return
      }
      if (frame.dataset.arkmeHarnessSource === 'qq2006') {
        frame.dataset.arkmeHarnessSource = 'native'
        frame.src = deepSeekHarnessEmbedUrl(nativeSettings)
      } else {
        applyQQ2006HarnessSkinToFrame(frame, false)
      }
    })
  }
  useEffect(() => {
    syncSkin()
    const unsubscribe = subscribeQQ2006HarnessSkin(syncSkin)
    return () => {
      unsubscribe()
      if (retryRef.current !== undefined) window.clearTimeout(retryRef.current)
    }
  }, [nativeSettings])

  return <section
    data-arkme-owned="deepseek-harness-surface"
    data-arkme-preload="true"
    data-arkme-visible={visible ? 'true' : 'false'}
    style={{
      ...styles.root,
      visibility: visible ? 'visible' : 'hidden',
      pointerEvents: visible ? 'auto' : 'none',
      zIndex: visible ? 1 : 0,
    }}
    aria-hidden={visible ? undefined : true}
    aria-label="DeepSeek Harness"
  >
    <iframe
      ref={frameRef}
      title="DeepSeek Harness"
      src={deepSeekHarnessEmbedUrl(nativeSettings)}
      data-arkme-harness-frame="true"
      data-arkme-harness-source="native"
      style={styles.frame}
      loading="eager"
      allow="clipboard-read; clipboard-write; microphone"
      onLoad={syncSkin}
    />
  </section>
}
