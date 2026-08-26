import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { stableUidForToolCall } from '../../shared/stable-id.js'

export const listFavoriteStickersToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.favorite-stickers-list.v1', toolName: 'arkme_favorite_stickers_list',
    kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_favorite_stickers_list',
      description: 'List the current Arkme account\'s favorite chat stickers and their account-bound file_asset_uid values.',
      parameters: {}, output: TEXT_OUTPUT,
      async execute(_args, exec) {
        return taggedJSON('Arkme 收藏表情', await ports.favoriteStickers(exec.signal))
      },
    })
  },
})

export const sendFavoriteStickerToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.favorite-sticker-send.v1', toolName: 'arkme_favorite_sticker_send',
    kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_favorite_sticker_send',
      description: 'Send one existing Arkme favorite sticker to a private or group chat after an explicit human request. source_ref must come from arkme_sources_list and file_asset_uid must come from arkme_favorite_stickers_list.',
      parameters: {
        source_ref: { type: 'string', required: true, description: 'Account-bound chat source_ref.' },
        file_asset_uid: { type: 'string', required: true, description: 'Account-bound favorite sticker file_asset_uid.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const callId = String(exec.callId)
        const result = await ports.sendFavoriteSticker(args.source_ref, args.file_asset_uid, {
          recordUid: stableUidForToolCall('sticker-record', callId),
          relationUid: stableUidForToolCall('sticker-relation', callId),
          signal: exec.signal,
        })
        return taggedJSON('Arkme 收藏表情发送结果', result)
      },
    })
  },
})

export const manageFavoriteStickerToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.favorite-sticker-manage.v1', toolName: 'arkme_favorite_sticker_manage',
    kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_favorite_sticker_manage',
      description: 'Move an existing Arkme favorite sticker to the front or delete it after an explicit human request. file_asset_uid must come from arkme_favorite_stickers_list.',
      parameters: {
        file_asset_uid: { type: 'string', required: true, description: 'Account-bound favorite sticker file_asset_uid.' },
        action: { type: 'string', required: true, enum: ['move-to-front', 'delete'], description: 'The explicitly requested management action.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 收藏表情管理结果', await ports.manageFavoriteSticker(args.file_asset_uid, args.action, exec.signal))
      },
    })
  },
})
