import { describe, expect, it, vi } from 'vitest'
import { addFavoriteStickerToolModule } from '../src/tools/business/conversation/favorite-stickers.js'

describe('arkme_favorite_sticker_add', () => {
  it('uses the explicit write grant and forwards only bounded asset metadata to the Host owner', async () => {
    const addFavoriteSticker = vi.fn(async () => ({ items: [], itemCount: 0, updatedAtMillis: 1 }))
    const tool = addFavoriteStickerToolModule.create({ addFavoriteSticker } as never)
    const signal = new AbortController().signal

    await tool.execute({
      file_asset_uid: 'asset-12345678',
      file_name: 'wave.gif',
      mime_type: 'image/gif',
      size: 128,
      is_animated: true,
    }, { signal } as never)

    expect(addFavoriteStickerToolModule.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
    expect(addFavoriteSticker).toHaveBeenCalledWith({
      fileAssetUid: 'asset-12345678',
      fileName: 'wave.gif',
      mimeType: 'image/gif',
      size: 128,
      fileKind: 1,
      isAnimated: true,
    }, signal)
  })
})
