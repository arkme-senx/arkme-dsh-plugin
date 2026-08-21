import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defineArkmeContextToolModule } from '../../contract/module.js'
import type { ArkmeMediaToolPort } from '../../ports/media.js'

export type ArkmeImageReadService = ArkmeMediaToolPort

interface ArkmeImageToolValue {
  source: string
  image: {
    attachmentId: string
    mediaType: ImageMediaType
    bytes: number
    width: number
    height: number
    name?: string
  }
}

function attachmentFromValue(image: ArkmeImageToolValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
  }
}

function imageToolContent(value: ArkmeImageToolValue): ContentBlock[] {
  return [
    {
      type: 'text',
      text: `<source>${value.source}</source>\n<type>image</type>\n<content>${value.image.mediaType} image, ${String(value.image.width)}x${String(value.image.height)} px, ${String(value.image.bytes)} bytes</content>`,
    },
    { type: 'image', attachment: attachmentFromValue(value.image) },
  ]
}

async function assertImageCapableRoute(ctx: Context, exec: ToolRunContext): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('cannot read the Arkme image: the current model route could not be resolved')
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`cannot read the Arkme image: model "${model}" does not declare image input`)
  }
}

/** Create the model-facing Arkme image tool while the DSH durable attachment service is mounted. */
export function createArkmeImageToolDefinition(ctx: Context, service: ArkmeImageReadService): ToolDefinition {
  return defineTool({
    name: 'arkme_image_read',
    description: 'Read an image reference returned by the Arkme Provider and return the image itself. This includes image-library items, the signed-in profile avatar, and authorized private/group chat avatars. The Provider refreshes Arkme authorization without exposing signed OSS URLs and rejects guessed or cross-account references. Requires the current model to accept image input.',
    parameters: {
      image_ref: {
        type: 'string',
        required: true,
        description: 'An image reference returned by arkme_images_list, arkme_user_profile, or arkme_sources_list. Never construct, parse, or guess this value.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => imageToolContent(value),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const imageRef = args.image_ref.trim()
      if (imageRef === '') throw new Error('image_ref must not be empty')
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('cannot read the Arkme image: no attachment service is mounted')
      if (attachments.imageLimits.maxImagesPerMessage < 1) {
        throw new Error('cannot read the Arkme image: this deployment does not accept images')
      }
      await assertImageCapableRoute(ctx, exec)
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      const resolved = await service.readImage(imageRef, { maxBytes: byteCap, signal: exec.signal })
      if (!attachments.imageLimits.mediaTypes.includes(resolved.mediaType)) {
        throw new Error(`cannot read the Arkme image: ${resolved.mediaType} is not accepted by this deployment`)
      }
      let ref: ImageAttachmentRef
      try {
        const extension = resolved.mediaType === 'image/jpeg' ? 'jpg' : resolved.mediaType.slice('image/'.length)
        ref = await attachments.saveImage({
          data: resolved.data,
          mediaType: resolved.mediaType,
          name: `arkme-profile-image.${extension}`,
        })
      } catch (error) {
        if (!(error instanceof AttachmentError)) throw error
        throw new Error('cannot read the Arkme image: the downloaded bytes failed image validation', { cause: error })
      }
      const value: ArkmeImageToolValue = {
        source: 'Arkme Provider-authorized image',
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name === undefined ? {} : { name: ref.name }),
        },
      }
      if (exec.parent !== undefined) {
        exec.deferContext(createUserMessage({
          content: imageToolContent(value),
          source: { kind: 'plugin', plugin: 'dsh-arkme' },
        }))
      }
      return value
    },
  })
}

export const readImageToolModule = defineArkmeContextToolModule({
  meta: {
    id: 'business.media.read-image.v1',
    toolName: 'arkme_image_read',
    kind: 'business',
    phase: 'attachments',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create: createArkmeImageToolDefinition,
})
