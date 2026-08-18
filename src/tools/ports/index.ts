import type { ArkmeConversationToolPort } from './conversations.js'
import type { ArkmeMediaToolPort } from './media.js'
import type { ArkmeProfileToolPort } from './profile.js'
import type { ArkmeRecordToolPort } from './records.js'

export interface ArkmeCoreToolPorts extends
  ArkmeRecordToolPort,
  ArkmeProfileToolPort,
  ArkmeConversationToolPort {}

export interface ArkmeToolPorts extends ArkmeCoreToolPorts, ArkmeMediaToolPort {}

export type {
  ArkmeConversationToolPort, ArkmeMediaToolPort, ArkmeProfileToolPort, ArkmeRecordToolPort,
}
