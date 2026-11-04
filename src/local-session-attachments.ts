import { Context } from '@deepseek-ai/cordis'
import { AttachmentStore, type FileAttachmentRef, type ImageAttachmentRef, type ImageRequestTarget, type SaveFileAttachment, type SaveFileStreamAttachment, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { LocalAttachmentStore, type Config } from '@deepseek-ai/dsh-attachment-local'
import { existsSync } from 'node:fs'
import type {} from './local-session-persistence.js'

/** New objects are shared by the account; historical objects stay in their verified source stores. */
export default class LocalSessionAttachments extends AttachmentStore {
  static inject = ['arkmeLocalHistory']
  private readonly primary: LocalAttachmentStore
  private readonly sources = new Map<string, LocalAttachmentStore>()
  constructor(ctx: Context, private readonly config: Config & { dshHome: string }) {
    super(ctx)
    this.primary = new LocalAttachmentStore(ctx.isolate('attachments'), config)
  }
  get imageLimits() { return this.primary.imageLimits }
  private stores() {
    for (const dshHome of this.ctx.arkmeLocalHistory.attachmentHomes()) {
      if (dshHome === this.config.dshHome || this.sources.has(dshHome)) continue
      if (this.sources.size >= 34) throw new Error('本机附件来源数量已达上限')
      this.sources.set(dshHome, new LocalAttachmentStore(this.ctx.isolate('attachments'), { ...this.config, dshHome }))
    }
    return [this.primary, ...this.sources.values()]
  }
  private imageStore(ref: ImageAttachmentRef) {
    return this.stores().find(store => existsSync(store.imageHostPath(ref))) ?? this.primary
  }
  private fileStore(ref: FileAttachmentRef) {
    return this.stores().find(store => existsSync(store.fileHostPath(ref))) ?? this.primary
  }
  validateImage(input: SaveImageAttachment) { return this.primary.validateImage(input) }
  override saveImages(inputs: readonly SaveImageAttachment[]) { return this.primary.saveImages(inputs) }
  saveImage(input: SaveImageAttachment) { return this.primary.saveImage(input) }
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal) { return this.imageStore(ref).readImage(ref, signal) }
  override imageHostPath(ref: ImageAttachmentRef) { return this.imageStore(ref).imageHostPath(ref) }
  override readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget, signal?: AbortSignal) { return this.imageStore(ref).readImageRequest(ref, target, signal) }
  override saveFile(input: SaveFileAttachment) { return this.primary.saveFile(input) }
  override saveFileStream(input: SaveFileStreamAttachment) { return this.primary.saveFileStream(input) }
  override readFileStream(ref: FileAttachmentRef, signal?: AbortSignal) { return this.fileStore(ref).readFileStream(ref, signal) }
  override fileHostPath(ref: FileAttachmentRef) { return this.fileStore(ref).fileHostPath(ref) }
}
