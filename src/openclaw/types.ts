import type { SecretValue } from '../secret-value.js'
import type { OpenClawPreflightResult } from './cli-adapter.js'

export interface OpenClawLocalResources { channel: boolean; agent: boolean; account: boolean; binding: boolean }
export interface OpenClawSecretRef { provider: string; source: 'file'; id: string; providerPath: string }
export interface OpenClawSecretStore {
  persist(input: { resourceHash: string; secret: SecretValue }): Promise<OpenClawSecretRef>
  ensureOwnership(input: { resourceHash: string; localResourceExists: boolean }): Promise<void>
  isRestartRequired(resourceHash: string): Promise<boolean>
  markRestartRequired(resourceHash: string): Promise<void>
  clearRestartRequired(resourceHash: string): Promise<void>
}
export interface OpenClawCliPort {
  preflight(options?: { signal?: AbortSignal }): Promise<OpenClawPreflightResult>
  inspect(input: { agentId: string; accountId: string }, options?: { signal?: AbortSignal }): Promise<OpenClawLocalResources>
  ensureChannel(options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureAgent(input: { agentId: string; workspaceRef: string }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureAccountSecretRef(input: { accountId: string; secretRef: OpenClawSecretRef }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureBinding(input: { agentId: string; accountId: string }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  gatewayStatus(options?: { signal?: AbortSignal }): Promise<'reachable' | 'unreachable' | 'unknown'>
  restartGateway(options?: { signal?: AbortSignal }): Promise<'restarted' | 'service_not_installed'>
}
export type OpenClawProvisionResult =
  | { status: 'profile_not_found' }
  | { status: 'prerequisite_failed'; reason: 'binary' | 'version' | 'config' | 'model_auth' | 'gateway_service' }
  | { status: 'gateway_restart_confirmation_required'; resource_ref: string; impact: 'profile_all_agents' }
  | { status: 'local_configured' | 'connected_unverified' | 'runtime_online'; resource_ref: string }
