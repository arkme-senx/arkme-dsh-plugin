import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeClientConfig, ArkmeImagePayload } from '../types.js'
import { callArkme } from './api.js'
import { OutgoingCallRuntime } from './outgoing-call-runtime.js'

export function outgoingCallModalLayout(compact: boolean, fullscreen: boolean): CSSProperties {
  if (fullscreen) return { width: '100vw', height: '100vh', borderRadius: 0 }
  if (compact) return { width: 160, height: 280, borderRadius: 16 }
  return {
    width: 'min(960px, calc(100vw - 32px))',
    height: 'min(640px, calc(100vh - 32px))',
    borderRadius: 20,
  }
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2_147_483_000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(11, 14, 19, .52)', backdropFilter: 'blur(2px)',
}

const compactOverlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2_147_483_000, pointerEvents: 'none',
}

const frameStyle: CSSProperties = { width: '100%', height: '100%', display: 'block', border: 0, background: 'transparent' }

async function loadCallAvatar(imageRef: string): Promise<string> {
  const image = await callArkme<ArkmeImagePayload>('image.read', { imageRef })
  return `data:${image.mediaType};base64,${image.dataBase64}`
}

export function ArkmeOutgoingCallHost() {
  const runtimeRef = useRef<OutgoingCallRuntime>()
  if (runtimeRef.current === undefined) runtimeRef.current = new OutgoingCallRuntime({ loadAvatar: loadCallAvatar })
  const runtime = runtimeRef.current
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)

  useEffect(() => {
    runtime.mount()
    const onMessage = (event: MessageEvent) => { runtime.handleWindowMessage(event) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && runtime.getSnapshot().visible) runtime.cancel() }
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeyDown)
    void callArkme<ArkmeClientConfig>('auth.config')
      .then(config => { runtime.configure(config.callAssetBasePath) })
      .catch(() => undefined)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKeyDown)
      runtime.dispose()
    }
  }, [runtime])

  if (!snapshot.visible || typeof document === 'undefined') return null
  const compact = snapshot.compact && !snapshot.fullscreen
  const shellStyle: CSSProperties = {
    ...outgoingCallModalLayout(compact, snapshot.fullscreen),
    position: compact ? 'absolute' : 'relative',
    ...(compact ? { right: 24, bottom: 24 } : {}),
    overflow: 'hidden', pointerEvents: 'auto', background: '#101216',
    boxShadow: '0 24px 72px rgba(0,0,0,.32)',
  }
  const overlay = compact ? compactOverlayStyle : overlayStyle

  return createPortal(<div
    style={overlay}
    onMouseDown={(event) => { if (event.target === event.currentTarget) runtime.cancel() }}
  >
    <section role="dialog" aria-modal={!compact} aria-label={`与${snapshot.displayName}通话`} style={shellStyle}>
      {snapshot.phase === 'error' ? <div style={{
        width: '100%', height: '100%', display: 'grid', placeItems: 'center', padding: 32,
        boxSizing: 'border-box', color: '#fff', textAlign: 'center', fontFamily: 'PingFang SC, SF Pro Text, sans-serif',
      }}>
        <div><p style={{ margin: '0 0 18px', fontSize: 15 }}>{snapshot.error}</p><button
          type="button" onClick={() => { runtime.cancel() }} style={{
            height: 36, padding: '0 18px', border: 0, borderRadius: 18, background: '#fff', color: '#17191c', cursor: 'pointer',
          }}
        >关闭</button></div>
      </div> : <iframe
        ref={(node) => { runtime.attachFrame(node) }}
        src={`${snapshot.assetBasePath}/index.html`}
        name={JSON.stringify({ callRequestId: snapshot.callRequestId })}
        title={`与${snapshot.displayName}通话`}
        allow="camera; microphone; autoplay"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        style={frameStyle}
        onLoad={(event) => { runtime.attachFrame(event.currentTarget) }}
      />}
    </section>
  </div>, document.body)
}
