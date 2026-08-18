import type { ArkmeAiVideoToolPort } from './ai-video.js'
import type { ArkmeConversationToolPort } from './conversations.js'
import type { ArkmeMediaToolPort } from './media.js'
import type { ArkmeOutgoingCallToolPort } from './outgoing-call.js'
import type { ArkmeProfileToolPort } from './profile.js'
import type { ArkmeRecordToolPort } from './records.js'
import type { ArkmeWorldToolPort } from './world.js'
import type { ArkmeWechatToolPort } from './wechat.js'

export interface ArkmeCoreToolPorts extends
  ArkmeAiVideoToolPort,
  ArkmeRecordToolPort,
  ArkmeProfileToolPort,
  ArkmeConversationToolPort,
  ArkmeOutgoingCallToolPort,
  ArkmeWorldToolPort,
  ArkmeWechatToolPort {}

export interface ArkmeToolPorts extends ArkmeCoreToolPorts, ArkmeMediaToolPort {}

export type {
  ArkmeAiVideoToolPort, ArkmeConversationToolPort, ArkmeMediaToolPort, ArkmeOutgoingCallToolPort, ArkmeProfileToolPort, ArkmeRecordToolPort,
  ArkmeWorldToolPort, ArkmeWechatToolPort,
}
