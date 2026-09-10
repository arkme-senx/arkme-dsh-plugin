import { describe, expect, it, vi } from 'vitest'
import { MediaService } from '../src/services/media-service.js'
import { projectRecordReedit } from '../src/client/record-reedit-submissions.js'
import type { ArkmeRecordReeditSubmissionView } from '../src/record-reedit-contract.js'
import type { ArkmeTimelineItem } from '../src/types.js'

describe('re-edit media capability recovery', () => {
  it.each(['pending', 'failed', 'uncertain', 'committed'] as const)(
    'uses fresh authorized media after a Host restart while the receipt is %s', async state => {
      const runtime = {
        config: { environment: 'test' },
        requireSession: async () => ({ userId: 42, accessToken: 'test', refreshToken: 'test' }),
        fetchImpl: vi.fn(async () => new Response('media-bytes')),
      }
      const makeMedia = () => new MediaService(runtime as never, {} as never, {} as never, { recordUid: () => 'r' })
      const raw = { record_core: { record_uid: 'r', content_payload: {
        voice: { source_file_asset_uid: 'voice' },
        media_refs: [{ file_asset_uid: 'asset', file_name: 'attachment.pdf', mime_type: 'application/pdf', file_kind: 4 }],
      } } }
      const display = [{ file_asset_uid: 'asset', file_name: 'attachment.pdf', file_kind: 4, mime_type: 'application/pdf', size: 10,
        download_url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/attachment.pdf' }]
      const beforeRestart = makeMedia()
      const oldBlock = beforeRestart.richContentBlocks(raw, 42, display)[0]!
      const receipt: ArkmeRecordReeditSubmissionView = structuredClone({
        submissionId: 'submission', itemUid: 'r', state, baseVersion: 7, title: '', textContent: '已编辑', voiceFileAssetUid: 'voice',
        attachments: [{ selection: { fileAssetUid: 'asset' }, block: oldBlock,
          asset: { fileAssetUid: 'asset', fileName: 'attachment.pdf', mimeType: 'application/pdf', size: 10, fileKind: 4 } }],
        ...(state === 'committed' ? { result: { status: 'committed', itemUid: 'r', version: 8,
          revisionUid: 'revision', projectionState: 'pending' } } : {}),
      })
      const afterRestart = makeMedia()
      await expect(afterRestart.fetchMedia(oldBlock.mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
      const freshBlock = afterRestart.richContentBlocks(raw, 42, display)[0]!
      await expect(afterRestart.fetchMedia(freshBlock.mediaRef)).resolves.toMatchObject({ response: { status: 200 } })
      const item: ArkmeTimelineItem = { itemUid: 'r', title: '', textContent: '原文', status: 1, sendAtMillis: 1,
        recordVersion: state === 'committed' ? 8 : 7,
        mediaUnavailable: afterRestart.recordMediaUnavailable(raw, [freshBlock]), contentBlocks: [freshBlock] }
      expect(item.mediaUnavailable).toBe(true)
      const projected = projectRecordReedit(item, [receipt])
      expect(projected.contentBlocks?.[0]?.mediaRef).toBe(freshBlock.mediaRef)
      expect(projected.contentBlocks?.[0]?.originalRef).toBe(freshBlock.originalRef)
      await expect(afterRestart.fetchMedia(projected.contentBlocks![0]!.mediaRef)).resolves.toMatchObject({ response: { status: 200 } })
      expect(projected).toMatchObject({ textContent: '已编辑', recordVersion: item.recordVersion, sendAtMillis: 1 })
    },
  )
})
