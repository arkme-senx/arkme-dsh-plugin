import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ManagedAccessCredentialProvider } from '../managed-access-credential.js'
import type { SecretValue } from '../secret-value.js'

export type { ManagedAccessCredentialProvider } from '../managed-access-credential.js'

const MAX_JWT_PAYLOAD_CHARS = 16 * 1024

export interface OpenApiMcpPrincipal {
  userId: number
  loginDeviceId: number
}

export interface ManagedOpenApiCredential extends OpenApiMcpPrincipal {
  schemaVersion: 1
  keyId: string
  generation: number
  apiKey: string
  expiresAtMillis: number
  mcpRevision: string
}

export type OpenApiMcpState =
  | 'inactive'
  | 'reconciling'
  | 'ready'
  | 'degraded'
  | 'reauthorization-required'

/** Browser/model-safe lifecycle projection. It intentionally contains no principal or credential identifier. */
export interface OpenApiMcpStatus {
  state: OpenApiMcpState
  retryable: boolean
  userAction: 'none' | 'login' | 'reauthorize'
  nextReconcileAtMillis?: number
}

export type ManagedOpenApiControlResult = {
  state: 'ready'
  keyId: string
  generation: number
  expiresAtMillis: number
  reconcileAfterSeconds: number
  mcpRevision: string
} | {
  state: 'issued'
  keyId: string
  generation: number
  apiKey: string
  expiresAtMillis: number
  reconcileAfterSeconds: number
  mcpRevision: string
} | {
  state: 'reauthorization_required'
  reconcileAfterSeconds: number
  mcpRevision: string
}

export interface ManagedOpenApiCredentialObservation {
  keyId: string
  generation: number
}

export interface ManagedOpenApiControlPlane {
  ensure(accessToken: SecretValue, observed: ManagedOpenApiCredentialObservation | undefined, signal: AbortSignal): Promise<ManagedOpenApiControlResult>
  reauthorize(accessToken: SecretValue, signal: AbortSignal): Promise<Extract<ManagedOpenApiControlResult, { state: 'issued' }>>
  disconnect(accessToken: SecretValue, observed: ManagedOpenApiCredentialObservation, signal: AbortSignal): Promise<void>
}

export interface ManagedOpenApiCredentialStore {
  read(): Promise<ManagedOpenApiCredential | undefined>
  write(credential: ManagedOpenApiCredential): Promise<void>
  delete(): Promise<void>
}

export interface OpenApiMcpMount {
  dispose(): Promise<void>
}

export interface OpenApiMcpRuntime {
  mount(apiKey: SecretValue, signal: AbortSignal): Promise<OpenApiMcpMount>
}

export interface OpenApiMcpReconcileLock {
  run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T>
}

export function openApiMcpPrincipal(session: ArkmeSessionCredentials | undefined): OpenApiMcpPrincipal | undefined {
  if (session === undefined) return undefined
  const payload = session.accessToken.split('.')[1]
  if (payload === undefined || payload === '' || payload.length > MAX_JWT_PAYLOAD_CHARS) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const userId = claims.user_id
    const loginDeviceId = claims.client_id
    if (userId !== session.userId || !Number.isSafeInteger(userId) || (userId as number) <= 0
      || !Number.isSafeInteger(loginDeviceId) || (loginDeviceId as number) <= 0) return undefined
    return { userId: userId as number, loginDeviceId: loginDeviceId as number }
  } catch {
    return undefined
  }
}

export function sameOpenApiMcpPrincipal(
  left: ArkmeSessionCredentials | undefined,
  right: ArkmeSessionCredentials | undefined,
): boolean {
  if (left === undefined && right === undefined) return true
  const leftPrincipal = openApiMcpPrincipal(left)
  const rightPrincipal = openApiMcpPrincipal(right)
  return leftPrincipal !== undefined && rightPrincipal !== undefined
    && leftPrincipal.userId === rightPrincipal.userId
    && leftPrincipal.loginDeviceId === rightPrincipal.loginDeviceId
}

export function credentialBelongsTo(
  credential: ManagedOpenApiCredential,
  principal: OpenApiMcpPrincipal,
): boolean {
  return credential.userId === principal.userId && credential.loginDeviceId === principal.loginDeviceId
}
