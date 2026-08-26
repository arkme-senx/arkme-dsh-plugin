import type { ArkmeOutgoingCallMediaType } from '../outgoing-call-contract.js'

export interface OutgoingCallUiRequest {
  sourceRef: string
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
}

export interface OutgoingCallUiSnapshot {
  pending?: OutgoingCallUiRequest
}

export interface OutgoingCallUiSettledEvent {
  callRequestId: string
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
  status: 'ended' | 'failed'
}

export class OutgoingCallUiController {
  private listeners = new Set<() => void>()
  private settledListeners = new Set<(event: OutgoingCallUiSettledEvent) => void>()
  private snapshot: OutgoingCallUiSnapshot = {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): OutgoingCallUiSnapshot => this.snapshot

  readonly subscribeSettled = (listener: (event: OutgoingCallUiSettledEvent) => void): (() => void) => {
    this.settledListeners.add(listener)
    return () => { this.settledListeners.delete(listener) }
  }

  request(request: OutgoingCallUiRequest): void {
    const sourceRef = request.sourceRef.trim()
    const displayName = request.displayName.trim()
    if (sourceRef === '' || displayName === '') throw new TypeError('私聊呼叫目标无效')
    console.info('ArkmeCallDiag ui_controller request', { sourceRef, displayName, mediaType: request.mediaType })
    this.snapshot = { pending: { sourceRef, displayName, mediaType: request.mediaType } }
    this.listeners.forEach(listener => { listener() })
  }

  consume(): OutgoingCallUiRequest | undefined {
    const pending = this.snapshot.pending
    if (pending !== undefined) this.snapshot = {}
    if (pending !== undefined) console.info('ArkmeCallDiag ui_controller consume', pending)
    return pending
  }

  notifySettled(event: OutgoingCallUiSettledEvent): void {
    console.info('ArkmeCallDiag ui_controller settled', event)
    this.settledListeners.forEach(listener => { listener(event) })
  }
}

export const outgoingCallUi = new OutgoingCallUiController()
