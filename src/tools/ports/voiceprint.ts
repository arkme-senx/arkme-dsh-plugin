import type {
  ArkmeMyVoiceprint,
  ArkmeRecognizedPersonDetail,
  ArkmeRecognizedPersonPage,
  ArkmeRecognizedVoiceprintLibrary,
  ArkmeVoiceprintGrantPage,
  ArkmeVoiceprintGrantRevocation,
  ArkmeVoiceprintInvitation,
  ArkmeVoiceprintPlaybackRestore,
} from '../../types.js'

export interface ArkmeVoiceprintToolPort {
  myVoiceprint(options?: { signal?: AbortSignal }): Promise<ArkmeMyVoiceprint>
  outboundVoiceprintGrants(
    input: { cursor: string; limit: number },
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeVoiceprintGrantPage>
  recognizedVoiceprintPeople(
    input: { cursor: string; limit: number },
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeRecognizedPersonPage>
  recognizedVoiceprintPerson(
    personRef: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeRecognizedPersonDetail>
  recognizedPersonVoiceprints(
    personRef: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeRecognizedVoiceprintLibrary>
  createVoiceprintInvitation(options?: { signal?: AbortSignal }): Promise<ArkmeVoiceprintInvitation>
  createRecognizedPersonVoiceprintInvitation(
    personRef: string,
    targetContactRef: string | undefined,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeVoiceprintInvitation>
  revokeVoiceprintPlaybackGrant(
    grantRef: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeVoiceprintGrantRevocation>
  restoreVoiceprintPlayback(options?: { signal?: AbortSignal }): Promise<ArkmeVoiceprintPlaybackRestore>
}
