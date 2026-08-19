import type { SecretValue } from '../secret-value.js'
import type { OpenClawPreflightResult } from './cli-adapter.js'

export interface OpenClawLocalResources { channel: boolean; agent: boolean; account: boolean; binding: boolean }
export interface OpenClawSecretRef { provider: string; source: 'file'; id: string; providerPath: string }
export interface OpenClawSecretStore {
  persist(input: { resourceHash: string; secret: SecretValue }): Promise<OpenClawSecretRef>
  ensureOwnership(input: { resourceHash: string; localResourceExists: boolean }): Promise<void>
}
export interface OpenClawCliPort {
  preflight(): Promise<OpenClawPreflightResult>
  inspect(input: { agentId: string; accountId: string }): Promise<OpenClawLocalResources>
  ensureChannel(): Promise<{ changed: boolean }>
  ensureAgent(input: { agentId: string; workspaceRef: string }): Promise<{ changed: boolean }>
  ensureAccountSecretRef(input: { accountId: string; secretRef: OpenClawSecretRef }): Promise<{ changed: boolean }>
  ensureBinding(input: { agentId: string; accountId: string }): Promise<{ changed: boolean }>
  gatewayStatus(): Promise<'reachable' | 'unreachable' | 'unknown'>
  restartGateway(): Promise<void>
}
export type OpenClawProvisionResult =
  | { status: 'profile_not_found' }
  | { status: 'prerequisite_failed'; reason: 'version' | 'config' | 'model_auth' }
  | { status: 'gateway_restart_confirmation_required'; resource_ref: string; impact: 'profile_all_agents' }
  | { status: 'local_configured' | 'connected_unverified' | 'runtime_online'; resource_ref: string }
