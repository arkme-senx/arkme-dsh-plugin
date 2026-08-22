export interface ArkmeRealtimeServiceDescriptor {
  service: string
  protocol: string
  protocolMajor: number
  participantMin: number
  participantMax: number
  allowObservers?: boolean
}

export interface ArkmeRealtimeInviteInput extends ArkmeRealtimeServiceDescriptor {
  sourceRef: string
  participantLimit: number
  fallbackText: string
  expiresAtMillis?: number
  clientMutationId?: string
}

export interface ArkmeRealtimeInvite {
  inviteRef: string
  state: string
  expiresAtMillis: number
  participantLimit: number
}

export interface ArkmeRealtimeInviteCard {
  schemaVersion: 1
  inviteRef: string
  extensionId: string
  service: string
  protocol: string
  protocolMajor: number
  expiresAtMillis: number
  participantLimit: number
  fallbackText: string
}

export interface ArkmeRealtimeRoomSession {
  inviteRef: string
  roomRef: string
  channelRef: string
  seatRef: string
  controllerGeneration: number
  state: string
}

export interface ArkmeRealtimeChannelEvent {
  channelRef: string
  commandId: string
  sequence: number
  senderClientRef: string
  controllerGeneration: number
  payload: unknown
  createdAtMillis: number
}

export interface ArkmeRealtimePublishResult {
  channelRef: string
  sequence: number
  duplicate: boolean
}

export interface ArkmeExtensionRealtimeFacade {
  provide(descriptor: ArkmeRealtimeServiceDescriptor): Promise<() => void>
  invite(input: ArkmeRealtimeInviteInput): Promise<ArkmeRealtimeInvite>
  enter(card: ArkmeRealtimeInviteCard, options?: { allowObserver?: boolean }): Promise<ArkmeRealtimeRoomSession>
  subscribe(
    channelRef: string,
    listener: (event: ArkmeRealtimeChannelEvent) => void,
    options?: { afterSequence?: number },
  ): Promise<() => void>
  publish(
    session: Pick<ArkmeRealtimeRoomSession, 'channelRef' | 'controllerGeneration'>,
    payload: unknown,
    options?: { commandId?: string },
  ): Promise<ArkmeRealtimePublishResult>
  close(channelRef: string): Promise<{ channelRef: string; state: string; idempotent: boolean }>
}

export interface ArkmeRealtimeHostService {
  forExtension(extensionId: string): ArkmeExtensionRealtimeFacade
  dispose(): void
}
