import { callArkme as callProvider } from '../sdk/index.js'
import type { PublicRecordingImportCurrentItem, PublicRecordingImportJob } from '../recording-import-shared.js'
import type { ArkmePluginOperation } from '../types.js'

export { ArkmeClientError } from '../sdk/index.js'

export type RecordingImportSnapshot = PublicRecordingImportCurrentItem

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
  signal?: AbortSignal,
): Promise<PublicRecordingImportJob> {
  const response = await fetch(importPath, {
    method: 'POST',
    headers: {
      'Content-Type': recordingImportMime(file),
      'X-Arkme-File-Name': encodeURIComponent(file.name),
      'X-Arkme-Start-At': String(startAtMillis),
      'X-Arkme-Belong-User': String(belongUserId),
    },
    body: file,
    credentials: 'same-origin',
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  let payload: { ok: boolean; value?: PublicRecordingImportJob; error?: { message?: string } }
  try {
    payload = await response.json() as typeof payload
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'AbortError') throw reason
    throw new Error('录音导入失败')
  }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message || '录音导入失败')
  }
  return payload.value
}

type ArkmeUiOperation = ArkmePluginOperation
  | 'provider.instance'
  | 'link.metadata'
  | 'directory.list'
  | 'directory.contact.profile'
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
  | 'calendar.records'
  | 'recordings.calendar'
  | 'recordings.day'
  | 'recordings.import.list'
  | 'recordings.import.history'
  | 'recordings.import.preflight'
  | 'recordings.import.status'
  | 'recordings.import.retry'
  | 'recordings.import.cancel'
  | 'recordings.import.session.update-start'
  | 'recordings.import.session.update-ownership'
  | 'recordings.import.session.delete'
  | 'recordings.playback.open'
  | 'recordings.speaker.options'
  | 'recordings.speaker.assign-item'
  | 'topic.create'
  | 'topic.rename'
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
  | 'source.related-quick-notes.from-message'
  | 'source.related-quick-notes.from-moment'
  | 'source.related-quick-note.detail'
  | 'source.message-copy-link'
  | 'source.message-copy-link.resolve'
  | 'source.message-copy-link.extend'
  | 'source.message-extension.context'
  | 'source.message-extension.extend'
  | 'source.forward-messages'
  | 'message-actions.copy-link'
  | 'message-actions.forward'
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
): Promise<T> {
  return await callProvider<T>(operation as ArkmePluginOperation, params, signal)
}
