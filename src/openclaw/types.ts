import type { SecretValue } from '../secret-value.js'
import type { OpenClawPreflightResult } from './cli-adapter.js'
export type {
  OpenClawChatOwnedCreatePreflight,
  OpenClawConnectionMetadata,
  OpenClawProvisionResult,
} from '../services/bot-service.js'

export const CHAT_OWNER_CHANNEL_VERSION = '0.1.13'
export const SUBJECT_OWNER_CHANNEL_VERSION = '0.1.12'
export type OpenClawChannelVersion = typeof CHAT_OWNER_CHANNEL_VERSION | typeof SUBJECT_OWNER_CHANNEL_VERSION

export interface OpenClawLocalResources { channel: boolean; channelVersion?: string; agent: boolean; account: boolean; accountGateway: boolean; binding: boolean }
export interface OpenClawSecretRef { provider: string; source: 'file'; id: string; providerPath: string }
export interface OpenClawSecretStore {
  persist(input: { resourceHash: string; secret: SecretValue; tokenPreview: string }): Promise<OpenClawSecretRef>
  matchesPreview(resourceHash: string, tokenPreview: string): Promise<boolean>
  ensureOwnership(input: { resourceHash: string; localResourceExists: boolean }): Promise<void>
  isRestartRequired(resourceHash: string): Promise<boolean>
  markRestartRequired(resourceHash: string): Promise<void>
  clearRestartRequired(resourceHash: string): Promise<void>
}
export interface OpenClawCliPort {
  preflight(options?: { signal?: AbortSignal }): Promise<OpenClawPreflightResult>
  inspect(input: { agentId: string; accountId: string; gatewayUrl: string }, options?: { signal?: AbortSignal }): Promise<OpenClawLocalResources>
  ensureChannel(input: { installed: boolean; targetVersion: OpenClawChannelVersion }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean; installedVersion?: string }>
  ensureAgent(input: { agentId: string; workspaceRef: string }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureAccountSecretRef(input: { accountId: string; secretRef: OpenClawSecretRef }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureAccountGatewayUrl(input: { accountId: string; gatewayUrl: string }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureBinding(input: { agentId: string; accountId: string }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  gatewayStatus(options?: { signal?: AbortSignal }): Promise<'reachable' | 'unreachable' | 'unknown'>
  restartGateway(options?: { signal?: AbortSignal }): Promise<'restarted' | 'service_not_installed'>
}
