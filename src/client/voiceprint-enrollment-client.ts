import type {
  ArkmePluginResponse,
  ArkmeVoiceprintEnrollmentResult,
} from '../types.js'
import type { ArkmeVoiceprintRecording } from './voiceprint-recorder.js'

export interface ArkmeVoiceprintEnrollmentClient {
  enroll(
    path: string,
    recording: ArkmeVoiceprintRecording,
    signal?: AbortSignal,
  ): Promise<ArkmeVoiceprintEnrollmentResult>
}

export class SameOriginArkmeVoiceprintEnrollmentClient implements ArkmeVoiceprintEnrollmentClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async enroll(
    path: string,
    recording: ArkmeVoiceprintRecording,
    signal?: AbortSignal,
  ): Promise<ArkmeVoiceprintEnrollmentResult> {
    const response = await this.fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Arkme-Duration-Ms': String(recording.durationMs) },
      body: new Uint8Array(recording.wav).buffer,
      ...(signal === undefined ? {} : { signal }),
    })
    const envelope = await response.json() as ArkmePluginResponse<ArkmeVoiceprintEnrollmentResult>
    if (!response.ok || !envelope.ok) {
      throw new Error(envelope.ok ? '声纹录入失败' : envelope.error.message)
    }
    return envelope.value
  }
}

export const arkmeVoiceprintEnrollmentClient = new SameOriginArkmeVoiceprintEnrollmentClient()
