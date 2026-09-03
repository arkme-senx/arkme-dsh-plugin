import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../keychain-store.js'
import { SecretValue } from '../secret-value.js'
import { OpenApiControlPlaneError } from './control-plane.js'
import { InvalidManagedOpenApiCredentialError } from './credential-store.js'
import { OpenApiMcpManifestError } from './manifest-source.js'
import type { SessionTransitionObserver } from './session-observer.js'
import {
  credentialBelongsTo,
  openApiMcpPrincipal,
  type ManagedAccessCredentialProvider,
  type ManagedOpenApiControlPlane,
  type ManagedOpenApiCredential,
  type ManagedOpenApiCredentialStore,
  type ManagedOpenApiCredentialExecutor,
  ManagedOpenApiCredentialRejectedError,
  ManagedOpenApiCredentialUnavailableError,
  ManagedOpenApiMcpExecutionSupersededError,
  type OpenApiMcpManifest,
  type OpenApiMcpManifestSource,
  type OpenApiMcpMount,
  type OpenApiMcpPrincipal,
  type OpenApiMcpReconcileLock,
  type OpenApiMcpRuntime,
  type OpenApiMcpStatus,
} from './types.js'

const MANAGED_TOOL_PREFIX = 'mcp__arkme__'
const CREDENTIAL_RETRY_DELAYS_MILLIS = [60_000, 5 * 60_000, 30 * 60_000] as const
const CREDENTIAL_FALLBACK_RECONCILE_MILLIS = 6 * 60 * 60_000
const MANIFEST_RETRY_DELAYS_MILLIS = [60_000, 5 * 60_000] as const
const MANIFEST_FALLBACK_RECONCILE_MILLIS = 5 * 60_000
const DISCONNECT_RETRY_DELAYS_MILLIS = [0, 1_000, 5_000] as const
const DISCONNECT_TIMEOUT_MILLIS = 10_000

interface OpenApiMcpLogger {
  warn(message: string, ...args: unknown[]): void
}

interface MountedCredential {
  principal: OpenApiMcpPrincipal
  keyId: string
  generation: number
  manifest: OpenApiMcpManifest
  mount: OpenApiMcpMount
}

export interface OpenApiMcpSessionTransition {
  changed: boolean
  nextPrincipal?: OpenApiMcpPrincipal
  previousCredential?: ManagedOpenApiCredential
}

export interface ManagedOpenApiMcpControllerOptions {
  mountMcp: boolean
  sessionStore: ArkmeSessionStore
  accessCredentialProvider: ManagedAccessCredentialProvider
  controlPlane: ManagedOpenApiControlPlane
  manifestSource: OpenApiMcpManifestSource
  credentialStore: ManagedOpenApiCredentialStore
  runtime: OpenApiMcpRuntime
  reconcileLock: OpenApiMcpReconcileLock
  logger: OpenApiMcpLogger
  now?: () => number
  random?: () => number
}

/** Sole owner of managed Key reconciliation and the official MCP Client mount lifecycle. */
export class ManagedOpenApiMcpController implements SessionTransitionObserver<OpenApiMcpSessionTransition>, ManagedOpenApiCredentialExecutor {
  private readonly now: () => number
  private readonly random: () => number
  private currentStatus: OpenApiMcpStatus
  private activePrincipal: OpenApiMcpPrincipal | undefined
  private activeCredential: ManagedOpenApiCredential | undefined
  private mounted: MountedCredential | undefined
  private operationQueue: Promise<void> = Promise.resolve()
  private credentialTimer: ReturnType<typeof setTimeout> | undefined
  private manifestTimer: ReturnType<typeof setTimeout> | undefined
  private credentialNextAtMillis: number | undefined
  private manifestNextAtMillis: number | undefined
  private activeAbort: AbortController | undefined
  private mountTransition: Promise<void> | undefined
  private mountCleanup: Promise<void> = Promise.resolve()
  private readonly toolExecutionAborts = new Set<AbortController>()
  private readonly credentialExecutionAborts = new Set<AbortController>()
  private credentialPreparation: Promise<void> | undefined
  private toolExecutionEnabled = false
  private credentialFailures = 0
  private manifestFailures = 0
  private diagnosticPending = false
  private epoch = 0
  private disposed = false

  constructor(private readonly options: ManagedOpenApiMcpControllerOptions) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.currentStatus = {
      state: options.mountMcp ? 'reconciling' : 'inactive', retryable: false, userAction: 'none',
    }
  }

  start(): void {
    if (!this.options.mountMcp || this.disposed) return
    const operationEpoch = this.epoch
    void this.enqueue(async () => { await this.reconcileCredential(operationEpoch) })
  }

  status(): OpenApiMcpStatus {
    return { ...this.currentStatus }
  }

  guardToolExecution(toolName: string): string | undefined {
    const ownsManagedNamespace = this.mounted !== undefined || this.mountTransition !== undefined
    if (!toolName.startsWith(MANAGED_TOOL_PREFIX) || !ownsManagedNamespace) return undefined
    if (this.mounted !== undefined && this.executionMatches(this.mounted)) return undefined
    return 'Arkme OpenAPI MCP tools are not ready for the current account'
  }

  /** Fences both sides of an official MCP dispatch and diagnoses managed failures in the background. */
  async executeManagedTool(
    toolName: string,
    callerSignal: AbortSignal,
    execute: (signal: AbortSignal) => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
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
      if (result.isError) this.scheduleDiagnosticReconcile(mounted)
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

  /** Leases the current managed API Key to one infrastructure callback and fences account changes. */
  async executeWithCredential<T>(
    callerSignal: AbortSignal,
    execute: (apiKey: SecretValue, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.disposed) throw new ManagedOpenApiCredentialUnavailableError()
    let credential = this.currentCredential()
    if (credential === undefined) {
      await this.ensureCredential(callerSignal)
      credential = this.currentCredential()
    }
    if (credential === undefined) throw new ManagedOpenApiCredentialUnavailableError()
    const snapshot = {
      epoch: this.epoch,
      principal: { ...this.activePrincipal! },
      keyId: credential.keyId,
      generation: credential.generation,
    }
    const lifecycleAbort = new AbortController()
    this.credentialExecutionAborts.add(lifecycleAbort)
    const signal = AbortSignal.any([callerSignal, lifecycleAbort.signal])
    try {
      const result = await execute(new SecretValue(credential.apiKey), signal)
      if (lifecycleAbort.signal.aborted || !this.credentialLeaseMatches(snapshot)) {
        throw new ManagedOpenApiMcpExecutionSupersededError()
      }
      return result
    } catch (error) {
      if (lifecycleAbort.signal.aborted || !this.credentialLeaseMatches(snapshot)) {
        throw new ManagedOpenApiMcpExecutionSupersededError()
      }
      if (error instanceof ManagedOpenApiCredentialRejectedError) this.scheduleCredentialDiagnostic()
      throw error
    } finally {
      this.credentialExecutionAborts.delete(lifecycleAbort)
    }
  }

  private async ensureCredential(callerSignal: AbortSignal): Promise<void> {
    const operationEpoch = this.epoch
    let preparation = this.credentialPreparation
    if (preparation === undefined) {
      preparation = this.enqueue(async () => {
        if (this.currentCredential() === undefined) await this.reconcileCredential(operationEpoch)
      })
      this.credentialPreparation = preparation
      void preparation.then(
        () => { if (this.credentialPreparation === preparation) this.credentialPreparation = undefined },
        () => { if (this.credentialPreparation === preparation) this.credentialPreparation = undefined },
      )
    }
    await waitForSignal(preparation, callerSignal)
    if (operationEpoch !== this.epoch) throw new ManagedOpenApiMcpExecutionSupersededError()
  }

  async retry(): Promise<OpenApiMcpStatus> {
    if (!this.options.mountMcp || this.disposed) return this.status()
    this.cancelCurrent(false)
    this.credentialFailures = 0
    this.manifestFailures = 0
    const operationEpoch = this.epoch
    await this.enqueue(async () => { await this.reconcileCredential(operationEpoch) })
    return this.status()
  }

  async prepare(
    previous: ArkmeSessionCredentials | undefined,
    next: ArkmeSessionCredentials | undefined,
  ): Promise<OpenApiMcpSessionTransition> {
    this.cancelCurrent(true)
    this.credentialFailures = 0
    this.manifestFailures = 0
    this.setStatus({ state: 'inactive', retryable: false, userAction: 'none' })
    const previousPrincipal = openApiMcpPrincipal(previous)
    const nextPrincipal = openApiMcpPrincipal(next)
    const previousCredential = previousPrincipal !== undefined && this.activeCredential !== undefined
      && credentialBelongsTo(this.activeCredential, previousPrincipal)
      ? this.activeCredential
      : undefined
    this.activePrincipal = undefined
    this.activeCredential = undefined
    this.beginMountCleanup()
    return {
      changed: true,
      ...(nextPrincipal === undefined ? {} : { nextPrincipal }),
      ...(previousCredential === undefined ? {} : { previousCredential }),
    }
  }

  committed(ticket: OpenApiMcpSessionTransition): void {
    if (!ticket.changed || this.disposed) return
    this.cancelCurrent(true)
    if (ticket.previousCredential !== undefined) this.disconnectCredential(ticket.previousCredential.apiKey)
    const operationEpoch = this.epoch
    void this.enqueue(async () => {
      await this.cleanupTransitionCredential(ticket.nextPrincipal)
      if (this.options.mountMcp) await this.reconcileCredential(operationEpoch)
    })
  }

  rolledBack(ticket: OpenApiMcpSessionTransition): void {
    if (!ticket.changed || this.disposed) return
    this.cancelCurrent(true)
    if (!this.options.mountMcp) return
    const operationEpoch = this.epoch
    void this.enqueue(async () => { await this.reconcileCredential(operationEpoch) })
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

  private async reconcileCredential(operationEpoch: number, background = false): Promise<void> {
    if (this.disposed || operationEpoch !== this.epoch) return
    const abort = new AbortController()
    this.activeAbort = abort
    const progress: { phase: 'credential' | 'manifest' } = { phase: 'credential' }
    const activeCredentialExpired = this.activeCredential !== undefined
      && this.activeCredential.expiresAtMillis <= this.now()
    if (activeCredentialExpired) {
      this.disableToolExecution()
      this.disableCredentialExecution()
    }
    if (this.options.mountMcp && (!background || activeCredentialExpired) && !this.toolExecutionEnabled) {
      this.setStatus({ state: 'reconciling', retryable: false, userAction: 'none' })
    }
    try {
      if (activeCredentialExpired) await this.disposeMount()
      const session = await this.options.sessionStore.read()
      const principal = openApiMcpPrincipal(session)
      if (session === undefined) {
        this.disableCredentialExecution()
        this.activePrincipal = undefined
        this.activeCredential = undefined
        await this.disposeMount()
        await this.options.reconcileLock.run(abort.signal, async () => {
          const credential = await this.readLocalCredential()
          if (credential !== undefined) await this.discardLocalCredential(credential)
        })
        this.setStatus({
          state: 'inactive', retryable: false,
          userAction: this.options.mountMcp ? 'login' : 'none',
        })
        return
      }
      if (principal === undefined) {
        this.disableCredentialExecution()
        this.activePrincipal = undefined
        this.activeCredential = undefined
        await this.disposeMount()
        throw new Error('managed principal unavailable')
      }
      this.assertCurrent(operationEpoch, abort.signal)
      await this.adoptPrincipal(principal)
      this.assertCurrent(operationEpoch, abort.signal)

      const outcome = await this.options.reconcileLock.run(abort.signal, async (): Promise<{
        credential: ManagedOpenApiCredential
        reconcileAfterMillis: number
      }> => {
        let credential = await this.readLocalCredential()
        if (credential !== undefined && !credentialBelongsTo(credential, principal)) {
          await this.discardLocalCredential(credential)
          credential = undefined
        }
        const activeCredential = this.activeCredential
        if (activeCredential !== undefined && (credential === undefined
          || !sameManagedCredential(activeCredential, credential))) {
          this.disableCredentialExecution()
          this.activeCredential = undefined
        }
        const accessToken = await this.resolveAccessCredential(principal, operationEpoch, abort.signal)
        const result = await this.options.controlPlane.ensure(accessToken, credential === undefined ? undefined : {
          keyId: credential.keyId,
          generation: credential.generation,
          keyDigest: managedCredentialDigest(credential),
        }, abort.signal)
        if (this.disposed || abort.signal.aborted || operationEpoch !== this.epoch) {
          if (result.state === 'issued') this.disconnectCredential(result.apiKey)
          throw abort.signal.reason ?? new Error('OpenAPI MCP lifecycle superseded')
        }

        let desired: ManagedOpenApiCredential
        if (result.state === 'issued') {
          desired = {
            schemaVersion: 1, ...principal, keyId: result.keyId, generation: result.generation,
            apiKey: result.apiKey, expiresAtMillis: result.expiresAtMillis,
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
        return { credential: desired, reconcileAfterMillis: result.reconcileAfterSeconds * 1000 }
      })
      this.assertCurrent(operationEpoch, abort.signal)
      if (this.options.mountMcp && !this.mountMatchesCredential(outcome.credential, principal)) {
        this.disableToolExecution()
        this.beginMountCleanup()
      }
      this.activeCredential = outcome.credential
      this.credentialFailures = 0
      this.scheduleCredential(outcome.reconcileAfterMillis, operationEpoch)

      if (!this.options.mountMcp) {
        this.setStatus({ state: 'inactive', retryable: false, userAction: 'none' })
        return
      }

      progress.phase = 'manifest'
      await this.refreshManifestFor(outcome.credential, principal, operationEpoch, abort.signal)
    } catch (error) {
      if (!abort.signal.aborted && !this.disposed && operationEpoch === this.epoch) {
        if (progress.phase === 'manifest') await this.handleManifestFailure(error, operationEpoch)
        else await this.handleCredentialFailure(error, operationEpoch)
      }
    } finally {
      if (this.activeAbort === abort) this.activeAbort = undefined
    }
  }

  private async refreshManifest(operationEpoch: number): Promise<void> {
    if (this.disposed || !this.options.mountMcp || operationEpoch !== this.epoch) return
    const abort = new AbortController()
    this.activeAbort = abort
    try {
      const session = await this.options.sessionStore.read()
      const principal = openApiMcpPrincipal(session)
      const credential = this.activeCredential
      if (principal === undefined || credential === undefined || !credentialBelongsTo(credential, principal)
        || !samePrincipal(this.activePrincipal, principal)) {
        this.scheduleCredential(60_000, operationEpoch)
        return
      }
      await this.refreshManifestFor(credential, principal, operationEpoch, abort.signal)
    } catch (error) {
      if (!abort.signal.aborted && !this.disposed && operationEpoch === this.epoch) {
        await this.handleManifestFailure(error, operationEpoch)
      }
    } finally {
      if (this.activeAbort === abort) this.activeAbort = undefined
    }
  }

  private async refreshManifestFor(
    credential: ManagedOpenApiCredential,
    principal: OpenApiMcpPrincipal,
    operationEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    const manifest = await this.options.manifestSource.read(signal)
    this.assertCurrent(operationEpoch, signal)
    await this.replaceMount(credential, principal, manifest, operationEpoch, signal)
    this.manifestFailures = 0
    this.scheduleManifest(manifest.pollAfterSeconds * 1000, operationEpoch)
    this.setReadyStatus()
  }

  private async handleCredentialFailure(error: unknown, operationEpoch: number): Promise<void> {
    this.credentialFailures++
    this.warn(failureCategory(error))
    if (this.activeCredential !== undefined && this.activeCredential.expiresAtMillis <= this.now()) {
      this.disableToolExecution()
      this.beginMountCleanup()
    }
    let session: ArkmeSessionCredentials | undefined
    try {
      session = await this.options.sessionStore.read()
    } catch {
      this.scheduleCredential(credentialRetryDelay(this.credentialFailures), operationEpoch)
      this.setStatusAfterCredentialFailure()
      return
    }
    if (session === undefined) {
      this.setStatus({ state: 'inactive', retryable: false, userAction: 'login' })
      return
    }
    this.scheduleCredential(credentialRetryDelay(this.credentialFailures), operationEpoch)
    this.setStatusAfterCredentialFailure()
  }

  private setStatusAfterCredentialFailure(): void {
    if (!this.options.mountMcp) {
      this.setStatus({ state: 'inactive', retryable: false, userAction: 'none' })
      return
    }
    this.setStatusFromExecutionAvailability()
  }

  private async handleManifestFailure(error: unknown, operationEpoch: number): Promise<void> {
    this.manifestFailures++
    this.warn(failureCategory(error))
    this.scheduleManifest(manifestRetryDelay(this.manifestFailures), operationEpoch)
    this.setStatusFromExecutionAvailability()
  }

  private scheduleDiagnosticReconcile(mounted: MountedCredential): void {
    if (this.disposed || this.diagnosticPending || !this.executionMatches(mounted)) return
    this.diagnosticPending = true
    const operationEpoch = this.epoch
    queueMicrotask(() => {
      void this.enqueue(async () => {
        try {
          if (!this.disposed && operationEpoch === this.epoch && this.executionMatches(mounted)) {
            await this.reconcileCredential(operationEpoch, true)
          }
        } finally {
          this.diagnosticPending = false
        }
      })
    })
  }

  private scheduleCredentialDiagnostic(): void {
    if (this.disposed || this.diagnosticPending) return
    this.diagnosticPending = true
    const operationEpoch = this.epoch
    queueMicrotask(() => {
      void this.enqueue(async () => {
        try {
          if (!this.disposed && operationEpoch === this.epoch) {
            await this.reconcileCredential(operationEpoch, true)
          }
        } finally {
          this.diagnosticPending = false
        }
      })
    })
  }

  private async adoptPrincipal(principal: OpenApiMcpPrincipal): Promise<void> {
    if (samePrincipal(this.activePrincipal, principal)) return
    this.disableCredentialExecution()
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
    manifest: OpenApiMcpManifest,
    operationEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    await this.mountCleanup
    this.assertCurrent(operationEpoch, signal)
    if (this.mounted !== undefined && this.toolExecutionEnabled
      && this.mountMatchesCredential(credential, principal)
      && sameManifest(this.mounted.manifest, manifest)) return
    await this.disposeMount()
    this.assertCurrent(operationEpoch, signal)
    const transition = this.mountFresh(credential, principal, manifest, operationEpoch, signal)
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
    manifest: OpenApiMcpManifest,
    operationEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    let candidate: MountedCredential | undefined
    const mount = this.options.runtime.mount(new SecretValue(credential.apiKey), manifest, signal, () => {
      if (candidate !== undefined) this.mountUnavailable(candidate)
    })
    candidate = {
      principal: { ...principal }, keyId: credential.keyId, generation: credential.generation,
      manifest: { ...manifest }, mount,
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
    this.manifestFailures++
    this.warn('mcp-unavailable')
    const operationEpoch = this.epoch
    this.scheduleCredential(manifestRetryDelay(this.manifestFailures), operationEpoch)
    this.setDegradedStatus()
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

  private disableCredentialExecution(): void {
    for (const abort of this.credentialExecutionAborts) {
      abort.abort(new ManagedOpenApiMcpExecutionSupersededError())
    }
    this.credentialExecutionAborts.clear()
  }

  private currentCredential(): ManagedOpenApiCredential | undefined {
    const credential = this.activeCredential
    const principal = this.activePrincipal
    if (credential === undefined || principal === undefined || credential.expiresAtMillis <= this.now()
      || !credentialBelongsTo(credential, principal)) return undefined
    return credential
  }

  private credentialLeaseMatches(snapshot: {
    epoch: number
    principal: OpenApiMcpPrincipal
    keyId: string
    generation: number
  }): boolean {
    const credential = this.currentCredential()
    return snapshot.epoch === this.epoch && credential !== undefined
      && credential.keyId === snapshot.keyId && credential.generation === snapshot.generation
      && samePrincipal(this.activePrincipal, snapshot.principal)
  }

  private executionMatches(mounted: MountedCredential): boolean {
    const credential = this.activeCredential
    return !this.disposed && credential !== undefined && credential.expiresAtMillis > this.now()
      && credential.keyId === mounted.keyId && credential.generation === mounted.generation
      && credentialBelongsTo(credential, mounted.principal)
      && this.toolExecutionEnabled && this.mounted === mounted
      && samePrincipal(this.activePrincipal, mounted.principal)
  }

  private mountMatchesCredential(credential: ManagedOpenApiCredential, principal: OpenApiMcpPrincipal): boolean {
    return this.mounted !== undefined
      && this.mounted.keyId === credential.keyId
      && this.mounted.generation === credential.generation
      && samePrincipal(this.mounted.principal, principal)
  }

  private async removeLocalCredential(): Promise<void> {
    this.disableCredentialExecution()
    this.activeCredential = undefined
    try { await this.options.credentialStore.delete() } catch { this.warn('credential-delete') }
  }

  private async discardLocalCredential(credential: ManagedOpenApiCredential): Promise<void> {
    this.disconnectCredential(credential.apiKey)
    await this.removeLocalCredential()
  }

  private async cleanupTransitionCredential(nextPrincipal: OpenApiMcpPrincipal | undefined): Promise<void> {
    try {
      await this.options.reconcileLock.run(new AbortController().signal, async () => {
        const candidate = await this.readLocalCredential()
        if (candidate === undefined || nextPrincipal !== undefined && credentialBelongsTo(candidate, nextPrincipal)) return
        await this.discardLocalCredential(candidate)
      })
    } catch { this.warn('credential-cleanup') }
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

  private scheduleCredential(delayMillis: number, operationEpoch: number): number {
    if (this.credentialTimer !== undefined) clearTimeout(this.credentialTimer)
    const jittered = this.jitter(delayMillis, 7 * 24 * 60 * 60_000)
    const scheduledAt = this.now()
    const remainingValidity = this.activeCredential === undefined
      ? undefined
      : this.activeCredential.expiresAtMillis - scheduledAt
    const boundedDelay = remainingValidity !== undefined && remainingValidity > 0
      ? Math.min(jittered, remainingValidity)
      : jittered
    const next = scheduledAt + boundedDelay
    this.credentialNextAtMillis = next
    this.credentialTimer = setTimeout(() => {
      this.credentialTimer = undefined
      this.credentialNextAtMillis = undefined
      if (!this.disposed && operationEpoch === this.epoch) {
        void this.enqueue(async () => { await this.reconcileCredential(operationEpoch) })
      }
    }, boundedDelay)
    this.credentialTimer.unref()
    return next
  }

  private scheduleManifest(delayMillis: number, operationEpoch: number): number {
    if (this.manifestTimer !== undefined) clearTimeout(this.manifestTimer)
    const jittered = this.jitter(delayMillis, 60 * 60_000)
    const next = this.now() + jittered
    this.manifestNextAtMillis = next
    this.manifestTimer = setTimeout(() => {
      this.manifestTimer = undefined
      this.manifestNextAtMillis = undefined
      if (!this.disposed && operationEpoch === this.epoch) {
        void this.enqueue(async () => { await this.refreshManifest(operationEpoch) })
      }
    }, jittered)
    this.manifestTimer.unref()
    return next
  }

  private jitter(delayMillis: number, maximumMillis: number): number {
    const bounded = Math.max(60_000, Math.min(maximumMillis, delayMillis))
    return Math.round(bounded * (0.9 + this.random() * 0.2))
  }

  private nextReconcileAtMillis(): number | undefined {
    const candidates = [this.credentialNextAtMillis, this.manifestNextAtMillis]
      .filter((value): value is number => value !== undefined)
    return candidates.length === 0 ? undefined : Math.min(...candidates)
  }

  private setReadyStatus(): void {
    const next = this.nextReconcileAtMillis()
    this.setStatus({
      state: 'ready', retryable: false, userAction: 'none',
      ...(next === undefined ? {} : { nextReconcileAtMillis: next }),
    })
  }

  private setDegradedStatus(): void {
    const next = this.nextReconcileAtMillis()
    this.setStatus({
      state: 'degraded', retryable: true, userAction: 'none',
      ...(next === undefined ? {} : { nextReconcileAtMillis: next }),
    })
  }

  private setStatusFromExecutionAvailability(): void {
    const mounted = this.mounted
    if (mounted !== undefined && this.executionMatches(mounted)) this.setReadyStatus()
    else this.setDegradedStatus()
  }

  private cancelCurrent(quarantineTools: boolean): void {
    this.epoch++
    this.credentialPreparation = undefined
    this.activeAbort?.abort(new Error('OpenAPI MCP lifecycle superseded'))
    this.activeAbort = undefined
    if (this.credentialTimer !== undefined) clearTimeout(this.credentialTimer)
    if (this.manifestTimer !== undefined) clearTimeout(this.manifestTimer)
    this.credentialTimer = undefined
    this.manifestTimer = undefined
    this.credentialNextAtMillis = undefined
    this.manifestNextAtMillis = undefined
    this.disableCredentialExecution()
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

function sameManagedCredential(left: ManagedOpenApiCredential, right: ManagedOpenApiCredential): boolean {
  return left.userId === right.userId && left.loginDeviceId === right.loginDeviceId
    && left.keyId === right.keyId && left.generation === right.generation && left.apiKey === right.apiKey
}

function managedCredentialDigest(credential: ManagedOpenApiCredential): string {
  return createHash('sha256').update(credential.apiKey, 'utf8').digest('hex')
}

function sameManifest(left: OpenApiMcpManifest, right: OpenApiMcpManifest): boolean {
  return left.catalogRevision === right.catalogRevision
    && left.runtimeRevision === right.runtimeRevision
    && left.endpointPath === right.endpointPath
}

function credentialRetryDelay(failures: number): number {
  if (failures > CREDENTIAL_RETRY_DELAYS_MILLIS.length) return CREDENTIAL_FALLBACK_RECONCILE_MILLIS
  return CREDENTIAL_RETRY_DELAYS_MILLIS[Math.max(0, failures - 1)] ?? CREDENTIAL_FALLBACK_RECONCILE_MILLIS
}

function manifestRetryDelay(failures: number): number {
  if (failures > MANIFEST_RETRY_DELAYS_MILLIS.length) return MANIFEST_FALLBACK_RECONCILE_MILLIS
  return MANIFEST_RETRY_DELAYS_MILLIS[Math.max(0, failures - 1)] ?? MANIFEST_FALLBACK_RECONCILE_MILLIS
}

function failureCategory(error: unknown): string {
  if (error instanceof OpenApiControlPlaneError) return `control-${error.kind}`
  if (error instanceof OpenApiMcpManifestError) return `manifest-${error.kind}`
  return 'runtime'
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function waitWithoutKeepingProcessAlive(delayMillis: number): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, delayMillis)
    timer.unref()
  })
}
