import type { ArkmeToolModule } from '../../contract/module.js'
import { listSourcesToolModule } from './list-sources.js'
import { sourceMemberRecordsToolModule, sourceMembersToolModule } from './member-records.js'
import { groupAiPolishToolModule } from './group-ai-polish.js'
import { addFavoriteStickerToolModule, listFavoriteStickersToolModule, manageFavoriteStickerToolModule, sendFavoriteStickerToolModule } from './favorite-stickers.js'
import { readSourceToolModule } from './read-source.js'
import { messageReadReceiptToolModules } from './read-receipts.js'
import { relatedRecordingsToolModule } from './related-recordings.js'
import { userBanToolModules } from './user-ban.js'
import { reportMessageToolModule } from './report-message.js'
import { withdrawMessageToolModule } from './withdraw-message.js'
import { sendDirectTextToolModule } from './send-direct-text.js'
import { sendTextToolModule } from './send-text.js'
import { startCallToolModule } from './start-call.js'
import { conversationMarkReadToolModule, unreadConversationsToolModule } from './unread.js'

export const conversationBusinessToolModules: readonly ArkmeToolModule[] = [
  listSourcesToolModule,
  unreadConversationsToolModule,
  readSourceToolModule,
  sourceMembersToolModule,
  sourceMemberRecordsToolModule,
  ...messageReadReceiptToolModules,
  conversationMarkReadToolModule,
  reportMessageToolModule,
  withdrawMessageToolModule,
  relatedRecordingsToolModule,
  ...userBanToolModules,
  groupAiPolishToolModule,
  listFavoriteStickersToolModule,
  addFavoriteStickerToolModule,
  sendFavoriteStickerToolModule,
  manageFavoriteStickerToolModule,
  sendTextToolModule,
  sendDirectTextToolModule,
  startCallToolModule,
]
