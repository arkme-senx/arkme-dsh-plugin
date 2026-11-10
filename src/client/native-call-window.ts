import { parseCallMessage } from './outgoing-call-bridge.js'
import type { OutgoingCallRuntime } from './outgoing-call-runtime.js'

interface CallWindowBridge {
  sync(id: string, basePath: string, visible: boolean, compact: boolean, fullscreen: boolean, error: string): void
  release(id: string): void
  command(id: string, type: string, payload: Record<string, unknown>): void
  listen(callback: (id: string, event: string, value: string) => void): () => void
}

export const nativeCallWindow = typeof window === 'undefined' ? undefined :
  (window as Window & { arkmeCallWindow?: CallWindowBridge }).arkmeCallWindow

export function connectNativeCallWindow(runtime: OutgoingCallRuntime, bridge: CallWindowBridge): () => void {
  let currentId = ''
  let presentation = ''
  function sync() {
    const state = runtime.getSnapshot()
    const id = state.visible || state.retainFrame ? state.callRequestId : ''
    if (id !== currentId) {
      if (currentId) bridge.release(currentId)
      currentId = id
      presentation = ''
      runtime.attachFrame(null)
    }
    if (!id) return
    const next = JSON.stringify([state.assetBasePath, state.visible, state.compact, state.fullscreen, state.error])
    if (presentation === next) return
    presentation = next
    bridge.sync(id, state.assetBasePath, state.visible, state.compact, state.fullscreen, state.error)
  }
  const stopEvents = bridge.listen((id, event, value) => {
    if (!id || id !== currentId) return
    if (event === 'loaded') {
      runtime.attachFrame({sendCommand(type, payload) {
        if (id !== currentId) return false
        bridge.command(id, type, payload)
        return true
      }})
    } else if (event === 'cancel') runtime.cancel()
    else {
      const message = parseCallMessage(value)
      if (message) runtime.handleBridgeMessage(message)
    }
  })
  const unsubscribe = runtime.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    stopEvents()
    if (currentId) bridge.release(currentId)
  }
}
