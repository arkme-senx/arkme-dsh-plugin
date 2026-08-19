import type { ArkmeAiVideoToolPort } from './ai-video.js'
import type { ArkmeArkoToolPort } from './arko.js'
import type { ArkmeBotToolPort } from './bots.js'
import type { ArkmeConversationToolPort } from './conversations.js'
import type { ArkmeMediaToolPort } from './media.js'
import type { ArkmeOutgoingCallToolPort } from './outgoing-call.js'
import type { ArkmeProfileToolPort } from './profile.js'
import type { ArkmeRecordingToolPort } from './recordings.js'
import type { ArkmeRecordToolPort } from './records.js'
import type { ArkmeWorldToolPort } from './world.js'
import type { ArkmeWechatToolPort } from './wechat.js'

export interface ArkmeCoreToolPorts extends
  ArkmeAiVideoToolPort,
  ArkmeArkoToolPort,
  ArkmeBotToolPort,
  ArkmeRecordToolPort,
  ArkmeProfileToolPort,
  ArkmeRecordingToolPort,
  ArkmeConversationToolPort,
  ArkmeOutgoingCallToolPort,
  ArkmeWorldToolPort,
  ArkmeWechatToolPort {}

export interface ArkmeToolPorts extends ArkmeCoreToolPorts, ArkmeMediaToolPort {}

export type {
  ArkmeAiVideoToolPort, ArkmeArkoToolPort, ArkmeBotToolPort, ArkmeConversationToolPort, ArkmeMediaToolPort, ArkmeProfileToolPort,
  ArkmeOutgoingCallToolPort, ArkmeRecordingToolPort, ArkmeRecordToolPort,
  ArkmeWorldToolPort, ArkmeWechatToolPort,
}
