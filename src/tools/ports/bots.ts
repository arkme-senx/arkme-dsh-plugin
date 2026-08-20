import type { SecretValue } from '../../secret-value.js'
import type { ArkmeBotList, ArkmeBotProvider, ArkmeBotSummary } from '../../types.js'
import type { ArkmeSourceItem } from '../../types.js'

export interface ArkmeBotCreateInput {
  name: string
  provider: ArkmeBotProvider
  description?: string
  avatar?: string
}

export interface ArkmeBotCreateResult {
  bot: ArkmeBotSummary
  secret: SecretValue
}

export interface ArkmeGroupBotItem extends Omit<ArkmeBotSummary, 'directChatAvailable'> {
  installed: boolean
}

export interface ArkmeGroupBotList {
  groupSourceRef: string
  displayName: string
  canAddBots: boolean
  items: ArkmeGroupBotItem[]
}

export interface ArkmeGroupBotMutationResult {
  botRef: string
  groupSourceRef: string
  installed: boolean
}

export interface ArkmeBotToolPort {
  listBots(options?: { signal?: AbortSignal }): Promise<ArkmeBotList>
  createBot(input: ArkmeBotCreateInput, options?: { signal?: AbortSignal }): Promise<ArkmeBotCreateResult>
  revealBotSecret(botRef: string, options?: { signal?: AbortSignal }): Promise<SecretValue>
  openBotChat(botRef: string, options?: { signal?: AbortSignal }): Promise<ArkmeSourceItem>
  listGroupBots(groupSourceRef: string, options?: { signal?: AbortSignal }): Promise<ArkmeGroupBotList>
  addGroupBot(groupSourceRef: string, botRef: string, options?: { signal?: AbortSignal }): Promise<ArkmeGroupBotMutationResult>
  removeGroupBot(groupSourceRef: string, botRef: string, options?: { signal?: AbortSignal }): Promise<ArkmeGroupBotMutationResult>
}
