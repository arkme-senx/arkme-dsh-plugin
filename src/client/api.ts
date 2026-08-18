import { callJotmo as callProvider } from '../sdk/index.js'
import type { JotmoPluginOperation } from '../types.js'

export { JotmoClientError } from '../sdk/index.js'

type JotmoUiOperation = JotmoPluginOperation | 'recordings.calendar' | 'recordings.day'

/** Built-in UI bridge. Recording operations intentionally stay out of the public Consumer SDK. */
export async function callJotmo<T>(
  operation: JotmoUiOperation,
  params?: Record<string, unknown>,
): Promise<T> {
  return await callProvider<T>(operation as JotmoPluginOperation, params)
}
