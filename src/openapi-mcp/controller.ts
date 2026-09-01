import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../keychain-store.js'
import { SecretValue } from '../secret-value.js'
import { OpenApiControlPlaneError } from './control-plane.js'
import { InvalidManagedOpenApiCredentialError } from './credential-store.js'
import type { SessionTransitionObserver } from './session-observer.js'
import {
  credentialBelongsTo,
  openApiMcpPrincipal,
  type ManagedAccessCredentialProvider,
  type ManagedOpenApiControlPlane,
  type ManagedOpenApiCredential,
  type ManagedOpenApiCredentialStore,
  type OpenApiMcpMount,
  type OpenApiMcpPrincipal,
  type OpenApiMcpReconcileLock,
  type OpenApiMcpRuntime,
  type OpenApiMcpStatus,
} from './types.js'

const MANAGED_TOOL_PREFIX = 'mcp__arkme__'
const RETRY_DELAYS_MILLIS = [60_000, 5 * 60_000, 30 * 60_000] as const
const FALLBACK_RECONCILE_MILLIS = 6 * 60 * 60_000
const DISCONNECT_RETRY_DELAYS_MILLIS = [0, 1_000, 5_000] as const
const DISCONNECT_TIMEOUT_MILLIS = 10_000

interface OpenApiMcpLogger {
  warn(message: string, ...args: unknown[]): void
}

interface MountedCredential {
  principal: OpenApiMcpPrincipal
  keyId: string
  generation: number
  catalogRevision: string
  runtimeRevision: string
  mount: OpenApiMcpMount
}

export interface OpenApiMcpSessionTransition {
  changed: boolean
  previousPrincipal?: OpenApiMcpPrincipal
  previousCredential?: ManagedOpenApiCredential
}

export interface ManagedOpenApiMcpControllerOptions {
  enabled: boolean
  sessionStore: ArkmeSessionStore
  accessCredentialProvider: ManagedAccessCredentialProvider
  controlPlane: ManagedOpenApiControlPlane
  credentialStore: ManagedOpenApiCredentialStore
  runtime: OpenApiMcpRuntime
  reconcileLock: OpenApiMcpReconcileLock
  logger: OpenApiMcpLogger
  now?: () => number
  random?: () => number
}

/** Fixed, credential-free failure used when a managed call crosses a lifecycle boundary. */
export class ManagedOpenApiMcpExecutionSupersededError extends Error {
  constructor() {
    super('Arkme OpenAPI MCP tools changed while this call was running; retry the request')
    this.name = 'ManagedOpenApiMcpExecutionSupersededError'
  }
}

/** Sole owner of managed Key reconciliation and the official MCP Client mount lifecycle. */
export class ManagedOpenApiMcpController implements SessionTransitionObserver<OpenApiMcpSessionTransition> {
  private readonly now: () => number
  private readonly random: () => number
  private currentStatus: OpenApiMcpStatus
  private activePrincipal: OpenApiMcpPrincipal | undefined
  private activeCredential: ManagedOpenApiCredential | undefined
  private mounted: MountedCredential | undefined
  private operationQueue: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private activeAbort: AbortController | undefined
  private mountTransition: Promise<void> | undefined
  private mountCleanup: Promise<void> = Promise.resolve()
  private readonly toolExecutionAborts = new Set<AbortController>()
  private toolExecutionEnabled = false
  private epoch = 0
  private failures = 0
  private disposed = false

  constructor(private readonly options: ManagedOpenApiMcpControllerOptions) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.currentStatus = {
      state: options.enabled ? 'reconciling' : 'inactive', retryable: false, userAction: 'none',
    }
  }

  start(): void {
    if (!this.options.enabled || this.disposed) return
    const operationEpoch = this.epoch
    void this.enqueue(async () => { await this.reconcile(false, operationEpoch) })
  }

  status(): OpenApiMcpStatus {
    return { ...this.currentStatus }
  }

  guardToolExecution(toolName: string): string | undefined {
    const ownsManagedNamespace = this.mounted !== undefined || this.mountTransition !== undefined
    if (!toolName.startsWith(MANAGED_TOOL_PREFIX) || !ownsManagedNamespace || this.toolExecutionEnabled) return undefined
    return 'Arkme OpenAPI MCP tools are not ready for the current account'
  }

  /**
   * Fences both sides of an official MCP dispatch. A session or mount change
   * aborts the transport and replaces any late result with a fixed safe error.
   */
  async executeManagedTool<T>(
    toolName: string,
    callerSignal: AbortSignal,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!toolName.startsWith(MANAGED_TOOL_PREFIX)) return await execute(callerSignal)
    const mounted = this.mounted
    if (mounted === undefined) return await execute(callerSignal)
    if (!this.executionMatches(mounted)) throw new ManagedOpenApiMcpExecutionSupersededError()

    const lifecycleAbort = new AbortController()
    this.toolExecutionAborts.add(lifecycleAbort)
    const signal = AbortSignal.any([callerSignal, lifecycleAbort.signal])
    try {
      const result = await execute(signal)
      if (lifecycleAbort.signal.aborted || !this.executionMatches(mounted)) {
        throw new ManagedOpenApiMcpExecutionSupersededError()
      }
      return result
    } catch (error) {
      if (lifecycleAbort.signal.aborted || !this.executionMatches(mounted)) {
        throw new ManagedOpenApiMcpExecutionSupersededError()
      }
      throw error
    } finally {
      this.toolExecutionAborts.delete(lifecycleAbort)
    }
  }

  async retry(): Promise<OpenApiMcpStatus> {
    if (!this.options.enabled || this.disposed) return this.status()
    this.cancelCurrent(false)
    const operationEpoch = this.epoch
    await this.enqueue(async () => {
      this.failures = 0
      await this.reconcile(false, operationEpoch)
    })
    return this.status()
  }

  async reauthorize(): Promise<OpenApiMcpStatus> {
    if (!this.options.enabled || this.disposed) return this.status()
    this.cancelCurrent(true)
    const operationEpoch = this.epoch
    await this.enqueue(async () => {
      this.failures = 0
      await this.reconcile(true, operationEpoch)
    })
    return this.status()
  }

  async prepare(
    previous: ArkmeSessionCredentials | undefined,
    _next: ArkmeSessionCredentials | undefined,
  ): Promise<OpenApiMcpSessionTransition> {
    this.cancelCurrent(true)
    this.setStatus({ state: 'inactive', retryable: false, userAction: 'none' })
    const previousPrincipal = openApiMcpPrincipal(previous)
    const previousCredential = previousPrincipal !== undefined && this.activeCredential !== undefined
      && credentialBelongsTo(this.activeCredential, previousPrincipal)
      ? this.activeCredential
      : undefined
    this.activePrincipal = undefined
    this.activeCredential = undefined
    this.beginMountCleanup()
    return {
      changed: true,
      ...(previousPrincipal === undefined ? {} : { previousPrincipal }),
      ...(previousCredential === undefined ? {} : { previousCredential }),
    }
  }

  committed(ticket: OpenApiMcpSessionTransition): void {
    if (!ticket.changed || this.disposed) return
    if (ticket.previousCredential !== undefined) this.disconnectCredential(ticket.previousCredential.apiKey)
    const operationEpoch = this.epoch
    void this.enqueue(async () => {
      if (ticket.previousCredential === undefined && ticket.previousPrincipal !== undefined) {
        try {
          const candidate = await this.readLocalCredential()
          if (candidate !== undefined && credentialBelongsTo(candidate, ticket.previousPrincipal)) {
            this.disconnectCredential(candidate.apiKey)
          }
        } catch { this.warn('credential-read') }
      }
      try { await this.options.credentialStore.delete() } catch { this.warn('credential-delete') }
      await this.reconcile(false, operationEpoch)
    })
  }

  rolledBack(ticket: OpenApiMcpSessionTransition): void {
    if (!ticket.changed || this.disposed) return
    const operationEpoch = this.epoch
    void this.enqueue(async () => { await this.reconcile(false, operationEpoch) })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.cancelCurrent(true)
    try {
      await this.operationQueue
      await this.mountCleanup
      await this.disposeMount()
    } finally {
      this.setStatus({ state: 'inactive', retryable: false, userAction: 'none' })
    }
  }

  private async reconcile(explicitReauthorization: boolean, operationEpoch: number): Promise<void> {
    if (this.disposed || !this.options.enabled || operationEpoch !== this.epoch) return
    const abort = new AbortController()
    this.activeAbort = abort
    this.setStatus({ state: 'reconciling', retryable: false, userAction: 'none' })
    try {
      await this.options.reconcileLock.run(abort.signal, async () => {
        const session = await this.options.sessionStore.read()
        const principal = openApiMcpPrincipal(session)
        if (session === undefined) {
          this.activePrincipal = undefined
          await this.removeLocalCredential()
          await this.disposeMount()
          this.setStatus({ state: 'inactive', retryable: false, userAction: 'login' })
          return
        }
        if (principal === undefined) {
          this.activePrincipal = undefined
          this.activeCredential = undefined
          await this.disposeMount()
          throw new Error('managed principal unavailable')
        }
        this.assertCurrent(operationEpoch, abort.signal)
        await this.adoptPrincipal(principal)
        this.assertCurrent(operationEpoch, abort.signal)

        let credential = await this.readLocalCredential()
        if (credential !== undefined && !credentialBelongsTo(credential, principal)) {
          await this.options.credentialStore.delete()
          credential = undefined
        }
        this.activeCredential = credential
        const accessToken = await this.resolveAccessCredential(principal, operationEpoch, abort.signal)
        const result = explicitReauthorization
          ? await this.options.controlPlane.reauthorize(accessToken, abort.signal)
          : await this.options.controlPlane.ensure(accessToken, credential === undefined ? undefined : {
            keyId: credential.keyId,
            generation: credential.generation,
          }, abort.signal)
        if (this.disposed || abort.signal.aborted || operationEpoch !== this.epoch) {
          if (result.state === 'issued') this.disconnectCredential(result.apiKey)
          throw abort.signal.reason ?? new Error('OpenAPI MCP lifecycle superseded')
        }

        if (result.state === 'reauthorization_required') {
          await this.removeLocalCredential()
          await this.disposeMount()
          this.failures = 0
          const next = this.schedule(result.reconcileAfterSeconds * 1000, operationEpoch)
          this.setStatus({ state: 'reauthorization-required', retryable: false, userAction: 'reauthorize', nextReconcileAtMillis: next })
          return
        }

        let desired: ManagedOpenApiCredential
        if (result.state === 'issued') {
          desired = {
            schemaVersion: 1, ...principal, keyId: result.keyId, generation: result.generation, apiKey: result.apiKey,
            expiresAtMillis: result.expiresAtMillis,
          }
          try {
            await this.options.credentialStore.write(desired)
          } catch (error) {
            this.disableToolExecution()
            this.beginMountCleanup()
            this.disconnectCredential(result.apiKey)
            throw error
          }
          if (this.disposed || abort.signal.aborted || operationEpoch !== this.epoch) {
            await this.removeLocalCredential()
            this.disconnectCredential(result.apiKey)
            throw abort.signal.reason ?? new Error('OpenAPI MCP lifecycle superseded')
          }
        } else {
          if (credential === undefined || credential.keyId !== result.keyId || credential.generation !== result.generation) {
            throw new Error('managed ready response does not match local credential')
          }
          desired = { ...credential, expiresAtMillis: result.expiresAtMillis }
          if (desired.expiresAtMillis !== credential.expiresAtMillis) {
            await this.options.credentialStore.write(desired)
          }
        }
        this.assertCurrent(operationEpoch, abort.signal)
        this.activeCredential = desired
        await this.replaceMount(
          desired,
          principal,
          result.mcpCatalogRevision,
          result.mcpRuntimeRevision,
          operationEpoch,
          abort.signal,
        )
        this.failures = 0
        const next = this.schedule(result.reconcileAfterSeconds * 1000, operationEpoch)
        this.setStatus({ state: 'ready', retryable: false, userAction: 'none', nextReconcileAtMillis: next })
      })
    } catch (error) {
      if (!abort.signal.aborted && !this.disposed && operationEpoch === this.epoch) {
        this.failures++
        this.warn(failureCategory(error))
        if (this.activeCredential !== undefined && this.activeCredential.expiresAtMillis <= this.now()) {
          this.disableToolExecution()
          this.beginMountCleanup()
        }
        const session = await this.options.sessionStore.read().catch(() => undefined)
        if (session === undefined) {
          this.setStatus({ state: 'inactive', retryable: false, userAction: 'login' })
        } else {
          const next = this.schedule(retryDelay(this.failures), operationEpoch)
          this.setStatus({ state: 'degraded', retryable: true, userAction: 'none', nextReconcileAtMillis: next })
        }
      }
    } finally {
      if (this.activeAbort === abort) this.activeAbort = undefined
    }
  }

  private async adoptPrincipal(principal: OpenApiMcpPrincipal): Promise<void> {
    if (samePrincipal(this.activePrincipal, principal)) return
    this.activePrincipal = principal
    this.activeCredential = undefined
    await this.disposeMount()
  }

  private async resolveAccessCredential(
    principal: OpenApiMcpPrincipal,
    operationEpoch: number,
    signal: AbortSignal,
  ): Promise<SecretValue> {
    const before = openApiMcpPrincipal(await this.options.sessionStore.read())
    if (!samePrincipal(before, principal)) throw new Error('managed principal changed')
    const accessToken = await this.options.accessCredentialProvider.resolveManagedAccessCredential()
    this.assertCurrent(operationEpoch, signal)
    const after = openApiMcpPrincipal(await this.options.sessionStore.read())
    if (!samePrincipal(after, principal)) throw new Error('managed principal changed')
    return accessToken
  }

  private async replaceMount(
    credential: ManagedOpenApiCredential,
    principal: OpenApiMcpPrincipal,
    catalogRevision: string,
    runtimeRevision: string,
    operationEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    await this.mountCleanup
    this.assertCurrent(operationEpoch, signal)
    if (this.mounted !== undefined && this.toolExecutionEnabled
      && this.mounted.keyId === credential.keyId && this.mounted.generation === credential.generation
      && this.mounted.catalogRevision === catalogRevision && this.mounted.runtimeRevision === runtimeRevision
      && samePrincipal(this.mounted.principal, principal)) return
    await this.disposeMount()
    this.assertCurrent(operationEpoch, signal)
    const transition = this.mountFresh(
      credential, principal, catalogRevision, runtimeRevision, operationEpoch, signal,
    )
    this.mountTransition = transition
    try {
      await transition
    } finally {
      if (this.mountTransition === transition) this.mountTransition = undefined
    }
  }

  private async mountFresh(
    credential: ManagedOpenApiCredential,
    principal: OpenApiMcpPrincipal,
    catalogRevision: string,
    runtimeRevision: string,
    operationEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    let candidate: MountedCredential | undefined
    const mount = this.options.runtime.mount(new SecretValue(credential.apiKey), signal, () => {
      if (candidate !== undefined) this.mountUnavailable(candidate)
    })
    candidate = {
      principal: { ...principal }, keyId: credential.keyId, generation: credential.generation,
      catalogRevision, runtimeRevision, mount,
    }
    this.mounted = candidate
    try {
      await mount.ready()
    } catch (error) {
      try { await this.disposeMount() } catch (disposeError) { throw disposeError }
      throw error
    }
    if (this.disposed || signal.aborted || operationEpoch !== this.epoch) {
      try { await this.disposeMount() } finally {
        throw signal.reason ?? new Error('OpenAPI MCP lifecycle changed')
      }
    }
    this.toolExecutionEnabled = true
  }

  private mountUnavailable(mounted: MountedCredential): void {
    if (this.disposed || this.mounted !== mounted) return
    this.cancelCurrent(true)
    this.beginMountCleanup()
    this.failures++
    this.warn('mcp-unavailable')
    const operationEpoch = this.epoch
    const next = this.schedule(retryDelay(this.failures), operationEpoch)
    this.setStatus({ state: 'degraded', retryable: true, userAction: 'none', nextReconcileAtMillis: next })
  }

  private async disposeMount(): Promise<void> {
    this.disableToolExecution()
    const mounted = this.mounted
    if (mounted === undefined) return
    await mounted.mount.dispose()
    if (this.mounted === mounted) this.mounted = undefined
  }

  private disableToolExecution(): void {
    this.toolExecutionEnabled = false
    for (const abort of this.toolExecutionAborts) {
      abort.abort(new ManagedOpenApiMcpExecutionSupersededError())
    }
    this.toolExecutionAborts.clear()
  }

  private executionMatches(mounted: MountedCredential): boolean {
    return !this.disposed && this.toolExecutionEnabled && this.mounted === mounted
      && samePrincipal(this.activePrincipal, mounted.principal)
  }

  private async removeLocalCredential(): Promise<void> {
    this.activeCredential = undefined
    try { await this.options.credentialStore.delete() } catch { this.warn('credential-delete') }
  }

  private beginMountCleanup(): void {
    const transition = this.mountTransition
    const cleanup = this.mountCleanup.then(async () => {
      if (transition !== undefined) await transition.catch(() => undefined)
      await this.disposeMount()
    })
    this.mountCleanup = cleanup.catch(() => { this.warn('mcp-dispose') })
  }

  private async readLocalCredential(): Promise<ManagedOpenApiCredential | undefined> {
    try {
      return await this.options.credentialStore.read()
    } catch (error) {
      if (!(error instanceof InvalidManagedOpenApiCredentialError)) throw error
      this.warn('credential-invalid')
      await this.removeLocalCredential()
      return undefined
    }
  }

  private disconnectCredential(apiKey: string): void {
    void (async () => {
      for (const delayMillis of DISCONNECT_RETRY_DELAYS_MILLIS) {
        if (delayMillis > 0) await waitWithoutKeepingProcessAlive(delayMillis)
        try {
          await this.options.controlPlane.disconnect(
            new SecretValue(apiKey), AbortSignal.timeout(DISCONNECT_TIMEOUT_MILLIS),
          )
          return
        } catch { /* bounded retry below */ }
      }
      this.warn('disconnect')
    })()
  }

  private schedule(delayMillis: number, operationEpoch: number): number {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const bounded = Math.max(60_000, Math.min(7 * 24 * 60 * 60_000, delayMillis))
    const jittered = Math.round(bounded * (0.9 + this.random() * 0.2))
    const next = this.now() + jittered
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (!this.disposed && operationEpoch === this.epoch) {
        void this.enqueue(async () => { await this.reconcile(false, operationEpoch) })
      }
    }, jittered)
    this.timer.unref()
    return next
  }

  private cancelCurrent(quarantineTools: boolean): void {
    this.epoch++
    this.activeAbort?.abort(new Error('OpenAPI MCP lifecycle superseded'))
    this.activeAbort = undefined
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (quarantineTools) this.disableToolExecution()
  }

  private assertCurrent(operationEpoch: number, signal: AbortSignal): void {
    if (this.disposed || signal.aborted || operationEpoch !== this.epoch) {
      throw signal.reason ?? new Error('OpenAPI MCP lifecycle superseded')
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.operationQueue.then(operation, operation)
    this.operationQueue = current.then(() => undefined, () => undefined)
    return current
  }

  private setStatus(status: OpenApiMcpStatus): void {
    this.currentStatus = { ...status }
  }

  private warn(category: string): void {
    this.options.logger.warn('dsh-arkme: OpenAPI MCP lifecycle degraded (%s)', category)
  }
}

function samePrincipal(left: OpenApiMcpPrincipal | undefined, right: OpenApiMcpPrincipal): boolean {
  return left?.userId === right.userId && left.loginDeviceId === right.loginDeviceId
}

function retryDelay(failures: number): number {
  if (failures > RETRY_DELAYS_MILLIS.length) return FALLBACK_RECONCILE_MILLIS
  return RETRY_DELAYS_MILLIS[Math.max(0, failures - 1)] ?? FALLBACK_RECONCILE_MILLIS
}

function failureCategory(error: unknown): string {
  if (error instanceof OpenApiControlPlaneError) return `control-${error.kind}`
  return 'runtime'
}

async function waitWithoutKeepingProcessAlive(delayMillis: number): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, delayMillis)
    timer.unref()
  })
}
