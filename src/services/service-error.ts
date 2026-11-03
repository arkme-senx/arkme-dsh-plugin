import type { ArkmePluginErrorBody } from '../types.js'

export class ArkmePluginError extends Error {
  readonly publishReceipt?: ArkmePluginErrorBody['publishReceipt']
  readonly upstreamStatus?: number
  readonly retryAfterMillis?: number
  readonly failureKind?: ArkmePluginErrorBody['failureKind']
  readonly retryScope?: ArkmePluginErrorBody['retryScope']
  readonly recovery?: ArkmePluginErrorBody['recovery']
  readonly imageFailures?: ArkmePluginErrorBody['imageFailures']
  /** The owner mutation may have completed, but the caller did not receive a usable acknowledgement. */
  readonly writeOutcomeUnknown?: true

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus = 400,
    options?: ErrorOptions & {
      upstreamStatus?: number
      retryAfterMillis?: number
      writeOutcomeUnknown?: boolean
      publishReceipt?: ArkmePluginErrorBody['publishReceipt']
      failureKind?: ArkmePluginErrorBody['failureKind']
      retryScope?: ArkmePluginErrorBody['retryScope']
      recovery?: ArkmePluginErrorBody['recovery']
      imageFailures?: ArkmePluginErrorBody['imageFailures']
    },
  ) {
    super(message, options)
    this.name = 'ArkmePluginError'
    if (options?.publishReceipt !== undefined) this.publishReceipt = options.publishReceipt
    if (options?.upstreamStatus !== undefined) this.upstreamStatus = options.upstreamStatus
    if (options?.retryAfterMillis !== undefined) this.retryAfterMillis = options.retryAfterMillis
    if (options?.failureKind !== undefined) this.failureKind = options.failureKind
    if (options?.retryScope !== undefined) this.retryScope = options.retryScope
    if (options?.recovery !== undefined) this.recovery = options.recovery
    if (options?.imageFailures !== undefined) this.imageFailures = options.imageFailures
    if (options?.writeOutcomeUnknown === true) this.writeOutcomeUnknown = true
  }
}
