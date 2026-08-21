import { callArkme as callProvider } from '../sdk/index.js'
import type { ArkmePluginOperation } from '../types.js'

export { ArkmeClientError } from '../sdk/index.js'

type ArkmeUiOperation = ArkmePluginOperation
  | 'provider.instance'
  | 'dsh-beta-community.entry-state'
  | 'dsh-beta-community.join'
  | 'calendar.buckets'
  | 'calendar.records'
  | 'recordings.calendar'
  | 'recordings.day'
  | 'topic.create'
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
  | 'extensions.catalog.list'
  | 'extensions.catalog.detail'
  | 'extensions.audit.check'
  | 'extensions.my-list'
  | 'extensions.delete'
  | 'extensions.installed-list'
  | 'extensions.updates'
  | 'extensions.install.preview'
  | 'extensions.install.start'
  | 'extensions.install.status'
  | 'extensions.install.pause'
  | 'extensions.install.resume'
  | 'extensions.uninstall'
  | 'extensions.restart'
  | 'extensions.persistent.client-state'
  | 'extensions.persistent.invoke'
  | 'extensions.bundle.invoke'
  | 'search.history'
  | 'search.history.create'
  | 'search.records'
  | 'search.scene'
  | 'search.recordings'
  | 'ai-video.list'
  | 'files.assets'

/** Built-in UI bridge. UI-only operations intentionally stay out of the public Consumer SDK. */
export async function callArkme<T>(
  operation: ArkmeUiOperation,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return await callProvider<T>(operation as ArkmePluginOperation, params, signal)
}
