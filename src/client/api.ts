import { arkmeAuthStore } from './auth-store.js'
import { ArkmeClientError } from '../sdk/index.js'
import type { TeamAppOperation } from '../team-app-contract.js'
import type { RecordAppOperation } from '../record-app-contract.js'
import { conversationWindowBridge, conversationWindowRequested } from './conversation-window.js'
import { callArkme as callProvider } from '../sdk/index.js'
import type { PublicRecordingImportCurrentItem, PublicRecordingImportJob } from '../recording-import-shared.js'
import type { ArkmePluginOperation } from '../types.js'
import { backgroundUiReads, supportsBackgroundRead } from './background-read.js'

export { ArkmeClientError } from '../sdk/index.js'

export type RecordingImportSnapshot = PublicRecordingImportCurrentItem

export interface RecordingImportUploadProgress {
  uploadedBytes: number
  totalBytes: number
}

export interface RecordingImportUploadOptions {
  signal?: AbortSignal
  onProgress?: (progress: RecordingImportUploadProgress) => void
  /** Manual microphone capture is 1; ordinary file/directory import defaults to 3. */
  recordingKind?: 1 | 3
}

function recordingImportMime(file: File): string {
  if (file.type !== '') return file.type
  const extension = file.name.toLowerCase().split('.').at(-1)
  return extension === 'wav' ? 'audio/wav' : extension === 'mp3' ? 'audio/mpeg' : extension === 'm4a' ? 'audio/mp4' : ''
}

export async function uploadArkmeRecording(
  importPath: string,
  file: File,
  startAtMillis: number,
  belongUserId: number,
  options: RecordingImportUploadOptions = {},
): Promise<PublicRecordingImportJob> {
  return await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let settled = false
    const cleanup = () => { options.signal?.removeEventListener('abort', abort) }
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      operation()
    }
    const abort = () => {
      request.abort()
      const error = new Error('录音导入已取消')
      error.name = 'AbortError'
      finish(() => { reject(error) })
    }
    if (options.signal?.aborted === true) {
      abort()
      return
    }
    request.open('POST', importPath)
    request.setRequestHeader('Content-Type', recordingImportMime(file))
    request.setRequestHeader('X-Arkme-File-Name', encodeURIComponent(file.name))
    request.setRequestHeader('X-Arkme-Start-At', String(startAtMillis))
    request.setRequestHeader('X-Arkme-Belong-User', String(belongUserId))
    request.setRequestHeader('X-Arkme-Recording-Kind', String(options.recordingKind ?? 3))
    request.upload.onprogress = event => {
      options.onProgress?.({
        uploadedBytes: Math.max(0, Math.min(file.size, Math.trunc(event.loaded))),
        totalBytes: file.size,
      })
    }
    request.onerror = () => { finish(() => { reject(new Error('录音导入失败')) }) }
    request.onabort = () => {
      const error = new Error('录音导入已取消')
      error.name = 'AbortError'
      finish(() => { reject(error) })
    }
    request.onload = () => {
      let payload: { ok: boolean; value?: PublicRecordingImportJob; error?: { message?: string } }
      try {
        payload = JSON.parse(request.responseText) as typeof payload
      } catch {
        finish(() => { reject(new Error('录音导入失败')) })
        return
      }
      if (request.status < 200 || request.status >= 300 || !payload.ok || payload.value === undefined) {
        finish(() => { reject(new Error(payload.error?.message || '录音导入失败')) })
        return
      }
      options.onProgress?.({ uploadedBytes: file.size, totalBytes: file.size })
      finish(() => { resolve(payload.value!) })
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    options.onProgress?.({ uploadedBytes: 0, totalBytes: file.size })
    request.send(file)
  })
}

type ArkmeUiOperation = ArkmePluginOperation | TeamAppOperation | RecordAppOperation
  | 'emoji.recent.list'
  | 'emoji.recent.record'
  | 'topic.candidates'
  | 'provider.instance'
  | 'link.metadata'
  | 'share.preview'
  | 'directory.list'
  | 'private-interaction.summary'
  | 'private-interaction.query'
  | 'directory.contact.profile'
  | 'directory.contact.remark.update'
  | 'directory.contact.world'
  | 'directory.contact.open-chat'
  | 'directory.group.open-chat'
  | 'directory.bot.open-chat'
  | 'bots.manage.profile'
  | 'bots.manage.update'
  | 'bots.manage.reveal-token'
  | 'bots.manage.delete'
  | 'bots.private-chat.notification.status'
  | 'bots.private-chat.notification.update'
  | 'unmarked-speakers.options'
  | 'unmarked-speakers.retry-inference'
  | 'unmarked-speakers.segments'
  | 'unmarked-speakers.mark'
  | 'voiceprint.status'
  | 'voiceprint.grants'
  | 'voiceprint.people'
  | 'voiceprint.person'
  | 'voiceprint.person.voiceprints'
  | 'voiceprint.person.invite'
  | 'voiceprint.invite'
  | 'voiceprint.revoke'
  | 'voiceprint.restore'
  | 'dsh-beta-community.entry-state'
  | 'dsh-beta-community.join'
  | 'calendar.buckets'
  | 'calendar.activity'
  | 'calendar.records'
  | 'recordings.history'
  | 'recordings.presence'
  | 'recordings.presence.capture'
  | 'recordings.calendar'
  | 'recordings.day'
  | 'recordings.compare'
  | 'recordings.compare.start'
  | 'recordings.forward.capabilities'
  | 'recordings.forward'
  | 'recordings.summary-model-config'
  | 'recordings.summary-model-config.set'
  | 'recordings.generate'
  | 'recordings.import.list'
  | 'recordings.import.history'
  | 'recordings.import.preflight'
  | 'recordings.import.status'
  | 'recordings.import.retry'
  | 'recordings.import.cancel'
  | 'recordings.import.session.update-start'
  | 'recordings.import.session.update-ownership'
  | 'recordings.import.session.delete'
  | 'recordings.import.transcription.retry'
  | 'recordings.playback.open'
  | 'recordings.speaker.options'
  | 'speaker-directory.summary'
  | 'speaker-directory.list'
  | 'speaker-directory.seen'
  | 'speaker-directory.open'
  | 'speaker-directory.avatars'
  | 'recordings.speaker.presence'
  | 'recordings.speaker.members'
  | 'recordings.speaker.cached-options'
  | 'recordings.speaker.recommendation'
  | 'recordings.speaker.assign-item'
  | 'topic.create'
  | 'topic.rename'
  | 'topic.home-visibility'
  | 'topic.dissolve'
  | 'topic.dissolve.status'
  | 'topic.dissolve.active'
  | 'arko.profile'
  | 'arko.session'
  | 'arko.new-session'
  | 'arko.models'
  | 'arko.model.activate'
  | 'arko.history'
  | 'arko.ask'
  | 'arko.run.status'
  | 'arko.cancel'
  | 'plugin.update.status'
  | 'plugin.update.check'
  | 'plugin.update.acknowledge'
  | 'plugin.update.install'
  | 'plugin.update.install-status'
  | 'source.interwoven-moments'
  | 'source.interwoven-detail'
  | 'source.interwoven-read-receipts'
  | 'source.related-quick-notes.from-message'
  | 'source.related-quick-notes.from-moment'
  | 'source.related-quick-note.detail'
  | 'source.record-edit-history'
  | 'source.message-copy-link'
  | 'source.message-copy-link.resolve'
  | 'source.message-copy-link.extend'
  | 'source.message-extension.context'
  | 'source.message-extension.parent'
  | 'source.message-extension.extend'
  | 'source.record-delete'
  | 'source.record-topic.assign'
  | 'source.forward-messages'
  | 'message-actions.copy-link'
  | 'message-actions.forward'
  | 'native-chat.forward'
  | 'native-chat.copy-link'
  | 'source.shared-recording-detail'
  | 'extensions.catalog.list'
  | 'extensions.classification.tree'
  | 'extensions.classification.items'
  | 'extensions.catalog.detail'
  | 'extensions.audit.check'
  | 'extensions.my-list'
  | 'extensions.delete'
  | 'extensions.installed-list'
  | 'extensions.quarantine.status'
  | 'extensions.quarantine.dismiss'
  | 'extensions.quarantine.reenable'
  | 'extensions.updates'
  | 'extensions.install.preview'
  | 'extensions.install.start'
  | 'extensions.install.status'
  | 'extensions.install.pause'
  | 'extensions.install.resume'
  | 'extensions.uninstall'
  | 'extensions.restart'
  | 'extensions.persistent.client-state'
  | 'extensions.bundle.client-state'
  | 'extensions.persistent.invoke'
  | 'extensions.bundle.invoke'
  | 'search.history'
  | 'search.history.create'
  | 'search.records'
  | 'search.conversations'
  | 'search.scene'
  | 'search.recordings'
  | 'ai-video.list'
  | 'files.assets'
  | 'world.voiceprint.invite'
  | 'calls.outgoing.diag'

/** Built-in UI bridge. UI-only operations intentionally stay out of the public Consumer SDK. */
export async function callArkme<T>(
  operation: ArkmeUiOperation,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
  options?: { priority?: 'background' },
): Promise<T> {
  if (conversationWindowRequested() && !await conversationWindowBridge()?.active()) throw new Error('会话窗口已失效，请关闭后重新打开')
  const auth = arkmeAuthStore.getSnapshot().auth
  const accountKey = operation.startsWith('team.app.') && auth?.status === 'authenticated'
    ? `${auth.environment}:${auth.userId}` : undefined
  // A retained view can still hold the previous account's refs during teardown.
  // Reject it locally instead of replacing its scope with the latest login.
  if (accountKey !== undefined && params?.expectedAccountKey !== undefined && params.expectedAccountKey !== accountKey) {
    throw new ArkmeClientError({ code: 'team-account-changed', message: '登录账号已变化，请重新打开团队消息', retryable: false })
  }
  let cleanupBackground: (() => void) | undefined
  try {
    const parameters = accountKey === undefined ? params : { ...params, expectedAccountKey: params?.expectedAccountKey ?? accountKey }
    const background = options?.priority === 'background' && supportsBackgroundRead(operation)
    const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
    const currentScope = () => {
      const current = arkmeAuthStore.getSnapshot().auth
      return current?.status === 'authenticated' ? `${current.environment}:${current.userId}` : undefined
    }
    const changedAccount = () => new ArkmeClientError({
      code: 'read-account-changed', message: '登录账号已变化，请重新读取', retryable: false,
    })
    let backgroundSignal: AbortSignal | undefined
    if (background) {
      // Avatar reads have no component AbortSignal. Account changes must still
      // cancel their fetches so old work cannot occupy the new account's budget.
      const controller = new AbortController()
      const abort = () => controller.abort(signal?.reason)
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
      const unsubscribe = arkmeAuthStore.subscribe(() => {
        if (currentScope() !== scope) controller.abort(changedAccount())
      })
      cleanupBackground = () => { unsubscribe(); signal?.removeEventListener('abort', abort) }
      backgroundSignal = controller.signal
    }
    const dispatch = async (requestSignal?: AbortSignal): Promise<T> => {
      if (background && currentScope() !== scope) throw changedAccount()
      const value = await callProvider<T>(operation as ArkmePluginOperation, parameters, requestSignal)
      if (background) {
        requestSignal?.throwIfAborted()
        if (currentScope() !== scope) throw changedAccount()
      }
      return value
    }
    // Keep the permit until callProvider has consumed the entire JSON body.
    // No key/recovery: existing owners retain deduplication and retry semantics.
    const value = background ? await backgroundUiReads.run({
      scope: scope ?? 'anonymous', lane: 'background-read', service: 'other', ...(backgroundSignal === undefined ? {} : { signal: backgroundSignal }),
      operation: dispatch,
    }) : await dispatch(signal)
    if (background) {
      // Account changes can arrive while the coordinator unwinds after dispatch.
      backgroundSignal?.throwIfAborted()
      if (currentScope() !== scope) throw changedAccount()
    }
    const current = arkmeAuthStore.getSnapshot().auth
    if (accountKey !== undefined && (current?.status !== 'authenticated' || `${current.environment}:${current.userId}` !== accountKey)) {
      throw new ArkmeClientError({ code: 'team-account-changed', message: '登录账号已变化，请重新打开团队消息', retryable: false })
    }
    return value
  } catch (error) {
    if ((error as { body?: { code?: string } })?.body?.code === 'team-account-changed') {
      void arkmeAuthStore.refresh().catch(() => undefined)
    }
    if (operation === 'auth.logout' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arkme:logout-failed', {
        detail: error instanceof Error ? error.message : String(error),
      }))
    }
    throw error
  } finally {
    cleanupBackground?.()
  }
}
