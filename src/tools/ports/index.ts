import type { ArkmeConversationToolPort } from './conversations.js'
import type { ArkmeMediaToolPort } from './media.js'
import type { ArkmeProfileToolPort } from './profile.js'
import type { ArkmeRecordToolPort } from './records.js'
import type { ArkmeWorldToolPort } from './world.js'
import type { ArkmeWechatToolPort } from './wechat.js'

export interface ArkmeCoreToolPorts extends
  ArkmeRecordToolPort,
  ArkmeProfileToolPort,
  ArkmeConversationToolPort,
  ArkmeWorldToolPort,
  ArkmeWechatToolPort {}

export interface ArkmeToolPorts extends ArkmeCoreToolPorts, ArkmeMediaToolPort {}

export type {
  ArkmeConversationToolPort, ArkmeMediaToolPort, ArkmeProfileToolPort, ArkmeRecordToolPort, ArkmeWorldToolPort, ArkmeWechatToolPort,
}
