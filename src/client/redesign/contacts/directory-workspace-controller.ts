import type { ArkmeSourceItem } from '../../../types.js'
import { callArkme } from '../../api.js'
import type { ArkmeDirectorySelection } from './contact-directory-state.js'

/** Legacy test-only request shape retained while Contacts moves to direct Host operations. */
export interface ArkmeSourceActivationRequest {
  revision: number
  sourceRef?: string
  source?: ArkmeSourceItem
}

export interface ArkmeDirectoryActivationFailure {
  botRef: string
  message: string
}

export interface ArkmeDirectoryWorkspaceSnapshot {
  accountKey?: string
  contextKey?: string
  directoryMode: boolean
  selection: ArkmeDirectorySelection
  refreshRevision: number
  sourceActivationRequest?: ArkmeSourceActivationRequest
  sourceActivationContextKey?: string
  botActivationFailure?: ArkmeDirectoryActivationFailure
  botActivationContextKey?: string
  mobileView: 'directory' | 'content'
}

export type ArkmeBotChatOpener = (botRef: string, signal: AbortSignal) => Promise<ArkmeSourceItem>

function initialSnapshot(
  accountKey?: string,
  contextKey?: string,
  directoryMode = false,
  mobileView: 'directory' | 'content' = 'directory',
): ArkmeDirectoryWorkspaceSnapshot {
  return {
    ...(accountKey === undefined ? {} : { accountKey }),
    ...(contextKey === undefined ? {} : { contextKey }),
    directoryMode,
    selection: { kind: 'none' },
    refreshRevision: 0,
    mobileView,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '无法打开 Bot 会话'
}

/** Shared owner for directory state spanning the persistent sidebar and conversation slots. */
export class ArkmeDirectoryWorkspaceController {
  private snapshot: ArkmeDirectoryWorkspaceSnapshot = initialSnapshot()
  private readonly listeners = new Set<() => void>()
  private activationGeneration = 0
  private sourceActivationRevision = 0
  private botController: AbortController | undefined

  constructor(
    private readonly openBotChat: ArkmeBotChatOpener = async (botRef, signal) => await callArkme(
      'directory.bot.open-chat', { botRef }, signal,
    ),
  ) {}

  readonly getSnapshot = (): ArkmeDirectoryWorkspaceSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Pure render-time view that masks activations from a stale account/session context. */
  getSnapshotForContext(accountKey: string | undefined, contextKey: string): ArkmeDirectoryWorkspaceSnapshot {
    if (accountKey === undefined) return initialSnapshot()
    if (this.snapshot.accountKey !== accountKey) return initialSnapshot(accountKey, contextKey, true)
    if (this.snapshot.contextKey !== contextKey) return initialSnapshot(accountKey, contextKey, false, 'content')
    const sourceCurrent = this.snapshot.sourceActivationContextKey === contextKey
    const failureCurrent = this.snapshot.botActivationContextKey === contextKey
    const {
      sourceActivationRequest,
      sourceActivationContextKey,
      botActivationFailure,
      botActivationContextKey,
      ...base
    } = this.snapshot
    return {
      ...base,
      ...(sourceCurrent && sourceActivationRequest !== undefined
        ? { sourceActivationRequest, sourceActivationContextKey } : {}),
      ...(failureCurrent && botActivationFailure !== undefined
        ? { botActivationFailure, botActivationContextKey } : {}),
    }
  }

  activateContext(accountKey: string | undefined, contextKey: string): void {
    if (this.snapshot.accountKey === accountKey && this.snapshot.contextKey === contextKey) return
    const initialDirectory = accountKey !== undefined && this.snapshot.accountKey !== accountKey
    this.invalidateActivations()
    this.publish(initialSnapshot(
      accountKey,
      accountKey === undefined ? undefined : contextKey,
      initialDirectory,
      initialDirectory ? 'directory' : 'content',
    ))
  }

  select(selection: Exclude<ArkmeDirectorySelection, { kind: 'none' }>): void {
    if (this.snapshot.accountKey === undefined) return
    this.invalidateActivations()
    this.publish({
      ...this.snapshot,
      directoryMode: true,
      selection,
      mobileView: 'content',
    })
  }

  showLogo(): void {
    if (this.snapshot.accountKey === undefined) return
    this.invalidateActivations()
    this.publish({
      ...this.snapshot,
      directoryMode: true,
      selection: { kind: 'none' },
      mobileView: 'content',
    })
  }

  refreshDirectory(): void {
    this.publish({ ...this.snapshot, refreshRevision: this.snapshot.refreshRevision + 1 })
  }

  openGroup(sourceRef: string): void {
    const normalized = sourceRef.trim()
    if (normalized === '' || this.snapshot.accountKey === undefined || this.snapshot.contextKey === undefined) return
    const contextKey = this.snapshot.contextKey
    this.invalidateActivations()
    this.sourceActivationRevision += 1
    this.publish({
      ...this.snapshot,
      directoryMode: false,
      selection: { kind: 'none' },
      sourceActivationRequest: { revision: this.sourceActivationRevision, sourceRef: normalized },
      sourceActivationContextKey: contextKey,
    })
  }

  openBot(botRef: string): void {
    const normalized = botRef.trim()
    if (normalized === '' || this.snapshot.accountKey === undefined || this.snapshot.contextKey === undefined) return
    const accountKey = this.snapshot.accountKey
    const contextKey = this.snapshot.contextKey
    this.invalidateActivations()
    this.publish({
      ...this.snapshot,
      directoryMode: false,
      selection: { kind: 'none' },
    })
    const generation = this.activationGeneration
    const controller = new AbortController()
    this.botController = controller
    void this.openBotChat(normalized, controller.signal).then(source => {
      if (!this.accepts(controller, generation, accountKey, contextKey)) return
      this.botController = undefined
      this.sourceActivationRevision += 1
      this.publish({
        ...this.snapshot,
        sourceActivationRequest: { revision: this.sourceActivationRevision, source },
        sourceActivationContextKey: contextKey,
      })
    }).catch(error => {
      if (!this.accepts(controller, generation, accountKey, contextKey)) return
      this.botController = undefined
      this.publish({
        ...this.snapshot,
        botActivationFailure: { botRef: normalized, message: errorMessage(error) },
        botActivationContextKey: contextKey,
      })
    })
  }

  retryBot(): void {
    const botRef = this.snapshot.botActivationFailure?.botRef
    if (botRef !== undefined) this.openBot(botRef)
  }

  activateNativeSurface(options: { passive?: boolean } = {}): boolean {
    if (options.passive === true
      && (this.snapshot.directoryMode || this.snapshot.mobileView === 'directory')) return false
    this.invalidateActivations()
    this.publish({
      ...this.snapshot,
      directoryMode: false,
      selection: { kind: 'none' },
      mobileView: 'content',
    })
    return true
  }

  returnToDirectory(): void {
    this.invalidateActivations()
    this.publish({
      ...this.snapshot,
      directoryMode: false,
      selection: { kind: 'none' },
      mobileView: 'directory',
    })
  }

  disconnect(): void {
    this.invalidateActivations()
    this.publish(initialSnapshot())
  }

  private accepts(controller: AbortController, generation: number, accountKey: string, contextKey: string): boolean {
    return !controller.signal.aborted
      && this.botController === controller
      && this.activationGeneration === generation
      && this.snapshot.accountKey === accountKey
      && this.snapshot.contextKey === contextKey
  }

  private invalidateActivations(): void {
    this.activationGeneration += 1
    this.botController?.abort()
    this.botController = undefined
    if (this.snapshot.sourceActivationRequest === undefined
      && this.snapshot.botActivationFailure === undefined) return
    const {
      sourceActivationRequest: _sourceActivationRequest,
      sourceActivationContextKey: _sourceActivationContextKey,
      botActivationFailure: _botActivationFailure,
      botActivationContextKey: _botActivationContextKey,
      ...retained
    } = this.snapshot
    this.snapshot = retained
  }

  private publish(next: ArkmeDirectoryWorkspaceSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

export const arkmeDirectoryWorkspace = new ArkmeDirectoryWorkspaceController()
