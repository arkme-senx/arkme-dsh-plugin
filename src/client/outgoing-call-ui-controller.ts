import type { JotmoOutgoingCallMediaType } from '../outgoing-call-contract.js'

export interface OutgoingCallUiRequest {
  sourceRef: string
  displayName: string
  mediaType: JotmoOutgoingCallMediaType
}

export interface OutgoingCallUiSnapshot {
  pending?: OutgoingCallUiRequest
}

export class OutgoingCallUiController {
  private listeners = new Set<() => void>()
  private snapshot: OutgoingCallUiSnapshot = {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): OutgoingCallUiSnapshot => this.snapshot

  request(request: OutgoingCallUiRequest): void {
    const sourceRef = request.sourceRef.trim()
    const displayName = request.displayName.trim()
    if (sourceRef === '' || displayName === '') throw new TypeError('私聊呼叫目标无效')
    this.snapshot = { pending: { sourceRef, displayName, mediaType: request.mediaType } }
    this.listeners.forEach(listener => { listener() })
  }

  consume(): OutgoingCallUiRequest | undefined {
    const pending = this.snapshot.pending
    if (pending !== undefined) this.snapshot = {}
    return pending
  }
}

export const outgoingCallUi = new OutgoingCallUiController()
