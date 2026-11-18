/** Native clipboard operations transfer opaque references, never renderer paths or video bytes. */
export interface ArkmeVideoClipboardBridge {
  version: 1
  supported: boolean
  begin(request: { requestId: string; accountKey: string }): Promise<void>
  copy(request: { requestId: string; accountKey: string; fileRef: string; mediaRef?: string }): Promise<{ copied: true }>
  cancel(requestId: string): Promise<void>
}

export function arkmeVideoClipboardBridge(): ArkmeVideoClipboardBridge | undefined {
  // Independent previews are portals; their hooks and native capability live in the opener.
  const bridge = typeof window === 'undefined' ? undefined
    : (window as Window & { arkmeDesktop?: { videoClipboard?: ArkmeVideoClipboardBridge } }).arkmeDesktop?.videoClipboard
  return bridge?.version === 1 && bridge.supported && typeof bridge.begin === 'function'
    && typeof bridge.copy === 'function' && typeof bridge.cancel === 'function' ? bridge : undefined
}

export async function copyArkmeVideo(
  bridge: ArkmeVideoClipboardBridge,
  accountKey: string,
  original: () => Promise<{ fileRef: string; mediaRef?: string }>,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const requestId = crypto.randomUUID()
  const cancel = () => { void bridge.cancel(requestId).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    // Reserve before any receive wait, so later completion cannot overwrite a newer clipboard.
    await bridge.begin({ requestId, accountKey })
    signal.throwIfAborted()
    const file = await original()
    signal.throwIfAborted()
    const result = await bridge.copy({ requestId, accountKey, ...file })
    signal.throwIfAborted()
    if (result?.copied !== true) throw new Error('video-clipboard-copy-failed')
  } finally {
    signal.removeEventListener('abort', cancel)
    // Also releases a reservation after receive failure or a begin/abort race.
    cancel()
  }
}
