import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProgressiveAttachments } from './services/progressive-attachments.js'
import { FileTransfers, type FileTransferSendOutcome } from './services/file-transfers.js'
import type { ChatService } from './services/chat-service.js'
import type { MediaService } from './services/media-service.js'
import { ArkmePluginError, type ServiceRuntime } from './services/service.js'
import type { SourceService } from './services/source-service.js'
export type { ArkmeFileSendInput, ArkmeLocalFile } from './file-transfer-contract.js'
export type { FileTransfers } from './services/file-transfers.js'

export function createArkmeFileTransfers(options: {
  directory: string | undefined
  maxUploadBytes: number | undefined
  runtime: ServiceRuntime
  source: SourceService
  media: MediaService
  teamMedia?:Pick<import('./services/team-app-service.js').TeamAppService,'fetchMedia'>
  chat: ChatService
  onProgressChange?: (userId: number, taskRef: string) => void
  openPath?: (path: string, signal: AbortSignal) => Promise<void>
}): FileTransfers | undefined {
  if (options.directory === undefined) return undefined
  const progressive = new ProgressiveAttachments(options.runtime)
  return new FileTransfers(options.directory, {
    ...(options.onProgressChange ? { onProgressChange: options.onProgressChange } : {}),
    currentUser: async () => (await options.runtime.requireSession()).userId,
    retainedFileRefs: async userId => [...await options.runtime.stateStore.recordReeditFileRefs(userId), ...await options.runtime.stateStore.arkoFileRefs(userId)],
    validateSource: async (sourceRef, userId) => {
      const source = await options.source.openSourceRef(sourceRef, userId)
      return `${source.kind}:${await options.source.sourceScopeKey(source)}`
    },
    upload: async (path, metadata, onProgress, expectedUserId, signal) => await options.media.uploadLocalFile(path, metadata, { onProgress, expectedUserId, signal }),
    progressive: {
      supported: (userId, signal) => progressive.supported(userId, signal),
      uploadPhotoThumbnail: async (path, target, expectedUserId, signal) => {
        const { default: sharp } = await import('sharp')
        const image = await sharp(path, { limitInputPixels: 40_000_000 }).rotate()
          .resize(720, 720, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
        signal.throwIfAborted()
        if (image.length === 0 || image.length > 512 * 1024) return
        const directory = await mkdtemp(join(tmpdir(), 'arkme-photo-preview-'))
        try {
          const fileName = 'preview.webp'
          const file = join(directory, fileName)
          const sha256 = createHash('sha256').update(image).digest('hex')
          await writeFile(file, image, { mode: 0o600 })
          const asset = await options.media.uploadLocalFile(file, {
            size: image.length, sha256, mimeType: 'image/webp', fileName, fileKind: 1,
          }, { expectedUserId, signal })
          await progressive.bindPhotoThumbnail(target, expectedUserId, asset.fileAssetUid, sha256, signal)
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      },
      reconcile: (recordUid, userId, signal) => progressive.reconcile(recordUid, userId, signal),
      retry: (target, userId, signal) => progressive.retry(target, userId, signal),
      upload: (path, metadata, onProgress, expectedUserId, signal, progressiveTarget, completionRecovery) => options.media.uploadLocalFile(path, metadata, { onProgress, expectedUserId, signal, progressiveTarget, completionRecovery }),
    },
    send: async (input, assets, backgroundSound, expectedUserId, signal, pending): Promise<FileTransferSendOutcome> => {
      try {
        const backgroundRefs = new Set(input.backgroundSound?.fileRefs ?? [])
        const ordinaryAssets = [...(input.content.assets ?? []), ...(pending ? [] : input.fileRefs.flatMap((ref, index) => backgroundRefs.has(ref) ? [] : [assets[index]!]))]
        if (input.attachmentOrder) {
          const order = new Map(input.attachmentOrder.map((key, index) => [key, index]))
          const uploaded = new Map((pending ? [] : input.fileRefs).map((ref, index) => [assets[index]!.fileAssetUid, ref]))
          ordinaryAssets.sort((a, b) => (order.get(uploaded.get(a.fileAssetUid) ?? a.fileAssetUid) ?? Infinity) - (order.get(uploaded.get(b.fileAssetUid) ?? b.fileAssetUid) ?? Infinity))
        }
        let result = await options.chat.sendSourceRich(input.sourceRef, {
          ...input.content,
          ...(ordinaryAssets.length === 0 ? {} : { assets: ordinaryAssets }),
          ...(backgroundSound === undefined ? {} : { backgroundSound }),
        }, {
          recordUid: input.recordUid, relationUid: input.relationUid, expectedUserId, signal, allowPlainText: true,
          ...(pending ? { pendingAttachments: pending, ...(input.attachmentOrder ? { attachmentOrder: input.attachmentOrder } : {}), ...(input.backgroundSound ? { backgroundAmplitudes: input.backgroundSound.amplitudes } : {}) } : {}),
        })
        if (input.location !== undefined) {
          try {
            await options.chat.saveMessageLocation(
              input.sourceRef,
              result.itemUid,
              input.location,
              undefined,
              { signal },
            )
          } catch (error) {
            // The record send is already authoritative. A location post-effect
            // failure must not turn it into an uncertain/retryable message send.
            const message = error instanceof ArkmePluginError ? error.message : '位置服务暂不可用，请稍后重试'
            result = { ...result, warningText: `消息已发送，但位置快照未写入：${message}` }
          }
        }
        return { kind: 'owner_accepted', result }
      } catch (error) {
        if (!(error instanceof ArkmePluginError)) return { kind: 'owner_outcome_unknown' }
        const retry = error.retryAfterMillis === undefined ? {} : { retryAfterMillis: error.retryAfterMillis }
        return error.writeOutcomeUnknown === true
          ? { kind: 'owner_outcome_unknown', message: error.message, code: error.code, ...retry }
          : { kind: 'owner_not_accepted', message: error.message, code: error.code, retryable: error.retryable, ...retry }
      }
    },
    fetchMedia: async (ref, signal) => {
      if(ref.startsWith('team-app-media.')){
        if(!options.teamMedia)throw new ArkmePluginError('team-media-unavailable','团队原件读取暂不可用',false,503)
        const result=await options.teamMedia.fetchMedia(ref,undefined,signal)
        return {response:result.response,descriptor:{fileName:result.fileName,mimeType:result.mimeType,size:result.size}}
      }
      return await options.media.fetchMedia(ref, undefined, signal, true)
    },
    ...(options.openPath === undefined ? {} : { openPath: options.openPath }),
    reconcile: async (input, signal) => {
      const exact=await options.chat.confirmSourceSend(input,signal)
      let result:import('./types.js').ArkmeSourceSendResult
      if(exact===false)return null
      if(exact===undefined)return undefined
      if(exact!==null)result=exact
      else{
        const page=await options.chat.readSource(input.sourceRef,{limit:100,signal})
        const item=page.items.find(value=>value.itemUid===input.recordUid&&value.isMe)
        if(!item)return undefined
        result={sourceRef:input.sourceRef,itemUid:item.itemUid,status:item.status,...(item.sequence===undefined?{}:{sequence:item.sequence}),localState:'synced'}
      }
      if (input.location === undefined) return result
      try {
        await options.chat.saveMessageLocation(input.sourceRef, result.itemUid, input.location, undefined, { signal })
        return result
      } catch (error) {
        const message = error instanceof ArkmePluginError ? error.message : '位置服务暂不可用，请稍后重试'
        return { ...result, warningText: `消息已确认发送，但位置快照未写入：${message}` }
      }
    },
  }, options.maxUploadBytes ?? 100 * 1024 * 1024)
}
