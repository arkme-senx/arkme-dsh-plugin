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
}

export type OpenApiMcpState =
  | 'inactive'
  | 'reconciling'
  | 'ready'
  | 'degraded'

/** Credential-free lifecycle status for Host API, SDK, UI, and internal diagnostics. */
export interface OpenApiMcpStatus {
  state: OpenApiMcpState
  retryable: boolean
  userAction: 'none' | 'login'
  nextReconcileAtMillis?: number
}

export type ManagedOpenApiControlResult = {
  state: 'ready'
  keyId: string
  generation: number
  expiresAtMillis: number
  reconcileAfterSeconds: number
} | {
  state: 'issued'
  keyId: string
  generation: number
  apiKey: string
  expiresAtMillis: number
  reconcileAfterSeconds: number
}

export interface OpenApiMcpManifest {
  catalogRevision: string
  runtimeRevision: string
  endpointPath: string
  pollAfterSeconds: number
}

export interface ManagedOpenApiCredentialObservation {
  keyId: string
  generation: number
  keyDigest: string
}

export interface ManagedOpenApiControlPlane {
  ensure(accessToken: SecretValue, observed: ManagedOpenApiCredentialObservation | undefined, signal: AbortSignal): Promise<ManagedOpenApiControlResult>
  disconnect(apiKey: SecretValue, signal: AbortSignal): Promise<void>
}

export interface OpenApiMcpManifestSource {
  read(signal: AbortSignal): Promise<OpenApiMcpManifest>
}

export interface ManagedOpenApiCredentialStore {
  read(): Promise<ManagedOpenApiCredential | undefined>
  write(credential: ManagedOpenApiCredential): Promise<void>
  delete(): Promise<void>
}

export interface OpenApiMcpMount {
  ready(): Promise<void>
  dispose(): Promise<void>
}

export interface OpenApiMcpRuntime {
  mount(apiKey: SecretValue, manifest: OpenApiMcpManifest, signal: AbortSignal, onUnavailable: () => void): OpenApiMcpMount
}

export interface OpenApiMcpReconcileLock {
  run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T>
}

/** Narrow lease used by OpenAPI transports; callers never receive a storable credential string. */
export interface ManagedOpenApiCredentialExecutor {
  executeWithCredential<T>(
    callerSignal: AbortSignal,
    execute: (apiKey: SecretValue, signal: AbortSignal) => Promise<T>,
  ): Promise<T>
}

/** Credential-free signal that the managed account lifecycle changed during a call. */
export class ManagedOpenApiMcpExecutionSupersededError extends Error {
  constructor() {
    super('Arkme OpenAPI MCP tools changed while this call was running; retry the request')
    this.name = 'ManagedOpenApiMcpExecutionSupersededError'
  }
}

/** Credential-free signal that a managed credential lease crossed an account change. */
export class ManagedOpenApiCredentialSupersededError extends Error {
  constructor() {
    super('Arkme OpenAPI credential changed while this call was running; retry the request')
    this.name = 'ManagedOpenApiCredentialSupersededError'
  }
}

/** Credential-free signal that no usable managed credential is currently available. */
export class ManagedOpenApiCredentialUnavailableError extends Error {
  constructor() {
    super('Arkme OpenAPI is not ready for the current account')
    this.name = 'ManagedOpenApiCredentialUnavailableError'
  }
}

/** Infrastructure-only signal that the leased key was rejected by OpenAPI. */
export class ManagedOpenApiCredentialRejectedError extends Error {
  constructor() {
    super('managed OpenAPI credential was rejected')
    this.name = 'ManagedOpenApiCredentialRejectedError'
  }
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
