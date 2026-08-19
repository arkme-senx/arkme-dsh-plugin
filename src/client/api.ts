import { callArkme as callProvider } from '../sdk/index.js'
import type { ArkmePluginOperation } from '../types.js'

export { ArkmeClientError } from '../sdk/index.js'

type ArkmeUiOperation = ArkmePluginOperation
  | 'dsh-beta-community.entry-state'
  | 'dsh-beta-community.join'
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

/** Built-in UI bridge. UI-only operations intentionally stay out of the public Consumer SDK. */
export async function callArkme<T>(
  operation: ArkmeUiOperation,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return await callProvider<T>(operation as ArkmePluginOperation, params, signal)
}
