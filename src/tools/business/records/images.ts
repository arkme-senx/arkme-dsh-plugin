import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ArkmeImageSearchResult } from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { boundedRecordLimit } from '../../shared/limits.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

function toolSafeImages(result: ArkmeImageSearchResult): Record<string, unknown> {
  return {
    items: result.items.map(({ mediaRef, ...item }) => ({ ...item, image_ref: mediaRef })),
    hasMore: result.hasMore,
    ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
    queryGuard: result.queryGuard,
  }
}

export const listImagesToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.records.images-list.v1',
    toolName: 'arkme_images_list',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_images_list',
      description: 'List the signed-in user\'s authorized Arkme image library. Results contain opaque image_ref values rather than storage URLs. Pass an image_ref unchanged to arkme_image_read only when the actual image is needed.',
      parameters: {
        cursor: { type: 'string', description: 'Opaque next cursor returned by a previous image-library page.' },
        limit: { type: 'integer', description: 'Maximum images to return, 1-30. Defaults to 10.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const cursor = args.cursor?.trim() ?? ''
        const result = await ports.searchImages({
          limit: boundedRecordLimit(args.limit),
          ...(cursor === '' ? {} : { cursor }),
          signal: exec.signal,
        })
        return taggedJSON('Arkme 图片库', toolSafeImages(result))
      },
    })
  },
})
