import { FileTransfers, type FileTransferSendOutcome } from './services/file-transfers.js'
import type { ChatService } from './services/chat-service.js'
import type { MediaService } from './services/media-service.js'
import type { ServiceRuntime } from './services/service.js'
import { ArkmePluginError } from './services/service.js'
import type { SourceService } from './services/source-service.js'
export type { ArkmeFileSendInput, ArkmeLocalFile } from './file-transfer-contract.js'
export type { FileTransfers } from './services/file-transfers.js'

export function createArkmeFileTransfers(options: {
  directory: string | undefined
  maxUploadBytes: number | undefined
  runtime: ServiceRuntime
  source: SourceService
  media: MediaService
  chat: ChatService
  openPath?: (path: string, signal: AbortSignal) => Promise<void>
}): FileTransfers | undefined {
  if (options.directory === undefined) return undefined
  return new FileTransfers(options.directory, {
    currentUser: async () => (await options.runtime.requireSession()).userId,
    validateSource: async sourceRef => { await options.source.openSourceRef(sourceRef, (await options.runtime.requireSession()).userId) },
    upload: async (path, metadata, onProgress, expectedUserId, signal) => await options.media.uploadLocalFile(path, metadata, { onProgress, expectedUserId, signal }),
    send: async (input, assets, expectedUserId, signal): Promise<FileTransferSendOutcome> => {
      try {
        return { kind: 'owner_accepted', result: await options.chat.sendSourceRich(input.sourceRef, { ...input.content, assets }, {
          recordUid: input.recordUid, relationUid: input.relationUid, expectedUserId, signal,
        }) }
      } catch (error) {
        if (!(error instanceof ArkmePluginError)) return { kind: 'owner_outcome_unknown' }
        return error.writeOutcomeUnknown === true
          ? { kind: 'owner_outcome_unknown' }
          : { kind: 'owner_not_accepted', message: error.message }
      }
    },
    fetchMedia: async (ref, signal) => await options.media.fetchMedia(ref, undefined, signal, true),
    ...(options.openPath === undefined ? {} : { openPath: options.openPath }),
    reconcile: async (input, signal) => {
      const page = await options.chat.readSource(input.sourceRef, { limit: 100, signal })
      const item = page.items.find(value => value.itemUid === input.recordUid && value.isMe)
      return item === undefined ? undefined : { sourceRef: input.sourceRef, itemUid: item.itemUid, status: item.status, ...(item.sequence === undefined ? {} : { sequence: item.sequence }), localState: 'synced' as const }
    },
  }, options.maxUploadBytes ?? 100 * 1024 * 1024)
}
