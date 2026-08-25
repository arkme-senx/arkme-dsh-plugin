import type { ArkmeAiVideoToolPort } from './ai-video.js'
import type { ArkmeArkoToolPort } from './arko.js'
import type { ArkmeBotToolPort } from './bots.js'
import type { ArkmeCalendarToolPort } from './calendar.js'
import type { ArkmeCallHistoryToolPort } from './call-history.js'
import type { ArkmeConversationToolPort } from './conversations.js'
import type { ArkmeContactToolPort } from './contacts.js'
import type { ArkmeMediaToolPort } from './media.js'
import type { ArkmeOutgoingCallToolPort } from './outgoing-call.js'
import type { ArkmeOpenClawToolPort } from './openclaw.js'
import type { ArkmeProfileToolPort } from './profile.js'
import type { ArkmeRecordingToolPort } from './recordings.js'
import type { ArkmeRecordToolPort } from './records.js'
import type { ArkmeWorldToolPort } from './world.js'
import type { ArkmeWechatToolPort } from './wechat.js'
import type { ArkmeVoiceprintToolPort } from './voiceprint.js'
import type { ArkmeExtensionReviewToolPort } from './extensions.js'
import type { ArkmeGroupToolPort } from './groups.js'

export interface ArkmeCoreToolPorts extends
  ArkmeAiVideoToolPort,
  ArkmeArkoToolPort,
  ArkmeBotToolPort,
  ArkmeCalendarToolPort,
  ArkmeCallHistoryToolPort,
  ArkmeRecordToolPort,
  ArkmeProfileToolPort,
  ArkmeRecordingToolPort,
  ArkmeConversationToolPort,
  ArkmeContactToolPort,
  ArkmeOutgoingCallToolPort,
  ArkmeOpenClawToolPort,
  ArkmeWorldToolPort,
  ArkmeExtensionReviewToolPort,
  ArkmeGroupToolPort,
  ArkmeWechatToolPort,
  ArkmeVoiceprintToolPort {}

export interface ArkmeToolPorts extends ArkmeCoreToolPorts, ArkmeMediaToolPort {}

export type {
  ArkmeAiVideoToolPort, ArkmeArkoToolPort, ArkmeBotToolPort, ArkmeCalendarToolPort, ArkmeConversationToolPort, ArkmeMediaToolPort, ArkmeProfileToolPort,
  ArkmeContactToolPort,
  ArkmeOpenClawToolPort, ArkmeOutgoingCallToolPort, ArkmeCallHistoryToolPort, ArkmeRecordingToolPort, ArkmeRecordToolPort,
  ArkmeWorldToolPort, ArkmeWechatToolPort,
  ArkmeVoiceprintToolPort,
  ArkmeExtensionReviewToolPort,
  ArkmeGroupToolPort,
}
