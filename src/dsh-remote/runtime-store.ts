import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { securePrivateDirectory, securePrivateFile } from '../private-filesystem.js'
import { DshRemoteError } from './errors.js'
import type { DshRemoteCapability, DshRemoteRuntimeProjection } from './types.js'

const MAX_RUNTIMES_PER_ACCOUNT = 16

interface AccountRuntimeState {
  displayName?: string
  desktopRef?: string
  runtimes: Record<string, DshRemoteRuntimeProjection>
  projections: Record<string, DshRemoteProjectionInventory>
}

export interface DshRemoteProjectionInventory {
  workspaceRefs: string[]
  sessions: Array<{
    sessionRef: string
    workspaceRef: string
    sourceUpdatedAt: number
  }>
}

interface PersistedRuntimeState {
  schemaVersion: 2
  accounts: Record<string, AccountRuntimeState>
}

function emptyState(): PersistedRuntimeState {
  return { schemaVersion: 2, accounts: {} }
}

function accountState(state: PersistedRuntimeState, accountId: string): AccountRuntimeState {
  return state.accounts[accountId] ?? { runtimes: {}, projections: {} }
}

export class DshRemoteRuntimeStore {
  private readonly path: string
  private state: PersistedRuntimeState | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.path = join(directory, 'dsh-remote', 'runtime-state.json')
  }

  async activateRuntime(input: {
    accountId: string
    profileRef: string
    capabilities: DshRemoteCapability[]
    nowMillis?: number
  }): Promise<DshRemoteRuntimeProjection> {
    let result!: DshRemoteRuntimeProjection
    await this.update(state => {
      const account = accountState(state, input.accountId)
      const current = account.runtimes[input.profileRef]
      if (current === undefined && Object.keys(account.runtimes).length >= MAX_RUNTIMES_PER_ACCOUNT) {
        throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '同一桌面账号最多注册 16 个 DSH Runtime')
      }
      result = {
        runtimeRef: current?.runtimeRef ?? `runtime_${randomUUID()}`,
        ...(account.desktopRef === undefined ? {} : { desktopRef: account.desktopRef }),
        profileRef: input.profileRef,
        accountId: input.accountId,
        hostGeneration: (current?.hostGeneration ?? 0) + 1,
        capabilities: [...new Set(input.capabilities)].sort(),
        updatedAtMillis: input.nowMillis ?? Date.now(),
      }
      account.runtimes[input.profileRef] = result
      state.accounts[input.accountId] = account
    })
    return result
  }

  async adoptRuntimeRef(
    accountId: string,
    profileRef: string,
    runtimeRef: string,
    hostGeneration?: number,
  ): Promise<DshRemoteRuntimeProjection> {
    const normalized = runtimeRef.trim()
    if (!/^[A-Za-z0-9._:-]{8,256}$/.test(normalized)) throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Backend Runtime 引用无效')
    if (hostGeneration !== undefined && (!Number.isSafeInteger(hostGeneration) || hostGeneration <= 0)) {
      throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Backend Host generation 无效')
    }
    let result!: DshRemoteRuntimeProjection
    await this.update(state => {
      const account = accountState(state, accountId)
      const runtime = account.runtimes[profileRef]
      if (runtime === undefined) throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控 Runtime 尚未注册')
      const collision = Object.entries(account.runtimes).some(([otherProfile, other]) => otherProfile !== profileRef && other.runtimeRef === normalized)
      if (collision) throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Backend Runtime 引用与其他 Profile 冲突')
      if (hostGeneration !== undefined && hostGeneration < runtime.hostGeneration) {
        throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Backend Host generation 发生回退')
      }
      result = {
        ...runtime,
        runtimeRef: normalized,
        hostGeneration: hostGeneration ?? runtime.hostGeneration,
        updatedAtMillis: Date.now(),
      }
      account.runtimes[profileRef] = result
      state.accounts[accountId] = account
    })
    return result
  }

  async bindDesktop(accountId: string, input: { desktopRef: string }): Promise<void> {
    await this.update(state => {
      const account = accountState(state, accountId)
      account.desktopRef = input.desktopRef
      for (const [profileRef, runtime] of Object.entries(account.runtimes)) {
        account.runtimes[profileRef] = { ...runtime, desktopRef: input.desktopRef }
      }
      state.accounts[accountId] = account
    })
  }

  async renameDesktop(accountId: string, displayName: string): Promise<void> {
    const normalized = displayName.trim()
    if (normalized === '' || [...normalized].length > 80) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '电脑名称必须为 1 至 80 个字符')
    await this.update(state => {
      const account = accountState(state, accountId)
      account.displayName = normalized
      state.accounts[accountId] = account
    })
  }

  async account(accountId: string): Promise<{
    displayName?: string
    desktopRef?: string
    runtimes: DshRemoteRuntimeProjection[]
  }> {
    return await this.read(state => {
      const account = accountState(state, accountId)
      return {
        ...(account.displayName === undefined ? {} : { displayName: account.displayName }),
        ...(account.desktopRef === undefined ? {} : { desktopRef: account.desktopRef }),
        runtimes: Object.values(account.runtimes).map(runtime => ({ ...runtime })),
      }
    })
  }

  async projectionInventory(
    accountId: string,
    profileRef: string,
  ): Promise<DshRemoteProjectionInventory> {
    return await this.read(state => {
      const inventory = accountState(state, accountId).projections[profileRef]
      return inventory === undefined
        ? { workspaceRefs: [], sessions: [] }
        : {
            workspaceRefs: [...inventory.workspaceRefs],
            sessions: inventory.sessions.map(value => ({ ...value })),
          }
    })
  }

  async saveProjectionInventory(
    accountId: string,
    profileRef: string,
    inventory: DshRemoteProjectionInventory,
  ): Promise<void> {
    await this.update(state => {
      const account = accountState(state, accountId)
      account.projections[profileRef] = {
        workspaceRefs: [...new Set(inventory.workspaceRefs)].sort(),
        sessions: [...inventory.sessions]
          .map(value => ({ ...value }))
          .sort((left, right) => left.sessionRef.localeCompare(right.sessionRef)),
      }
      state.accounts[accountId] = account
    })
  }

  private async read<T>(reader: (state: PersistedRuntimeState) => T): Promise<T> {
    let result!: T
    await this.serial(async () => { result = reader(await this.load()) })
    return result
  }

  private async update(mutator: (state: PersistedRuntimeState) => void): Promise<void> {
    await this.serial(async () => {
      const state = await this.load()
      mutator(state)
      await this.persist(state)
    })
  }

  private async serial(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work)
    this.queue = next.then(() => undefined, () => undefined)
    await next
  }

  private async load(): Promise<PersistedRuntimeState> {
    if (this.state !== undefined) return this.state
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>
      if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2) || raw.accounts === null || typeof raw.accounts !== 'object') {
        throw new Error('schema mismatch')
      }
      const accounts: Record<string, AccountRuntimeState> = {}
      for (const [accountId, value] of Object.entries(raw.accounts as Record<string, unknown>)) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('account schema mismatch')
        const source = value as Record<string, unknown>
        if (source.runtimes === null || typeof source.runtimes !== 'object' || Array.isArray(source.runtimes)) throw new Error('runtime schema mismatch')
        const runtimes: Record<string, DshRemoteRuntimeProjection> = {}
        for (const [profileRef, runtimeValue] of Object.entries(source.runtimes as Record<string, unknown>)) {
          if (runtimeValue === null || typeof runtimeValue !== 'object' || Array.isArray(runtimeValue)) throw new Error('runtime schema mismatch')
          const runtime = { ...(runtimeValue as Record<string, unknown>) }
          delete runtime.remoteEnabled
          runtimes[profileRef] = runtime as unknown as DshRemoteRuntimeProjection
        }
        const projections: Record<string, DshRemoteProjectionInventory> = {}
        if (source.projections !== undefined) {
          if (source.projections === null || typeof source.projections !== 'object' || Array.isArray(source.projections)) {
            throw new Error('projection inventory schema mismatch')
          }
          for (const [profileRef, inventoryValue] of Object.entries(source.projections as Record<string, unknown>)) {
            if (inventoryValue === null || typeof inventoryValue !== 'object' || Array.isArray(inventoryValue)) {
              throw new Error('projection inventory schema mismatch')
            }
            const inventory = inventoryValue as Record<string, unknown>
            if (!Array.isArray(inventory.workspaceRefs) || !Array.isArray(inventory.sessions)) {
              throw new Error('projection inventory schema mismatch')
            }
            const workspaceRefs = inventory.workspaceRefs.map(value => {
              if (typeof value !== 'string' || value.trim() === '') throw new Error('workspace inventory schema mismatch')
              return value
            })
            const sessions = inventory.sessions.map(value => {
              if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('session inventory schema mismatch')
              const session = value as Record<string, unknown>
              if (typeof session.sessionRef !== 'string' || session.sessionRef.trim() === ''
                || typeof session.workspaceRef !== 'string' || session.workspaceRef.trim() === ''
                || !Number.isSafeInteger(session.sourceUpdatedAt) || Number(session.sourceUpdatedAt) <= 0) {
                throw new Error('session inventory schema mismatch')
              }
              return {
                sessionRef: session.sessionRef,
                workspaceRef: session.workspaceRef,
                sourceUpdatedAt: Number(session.sourceUpdatedAt),
              }
            })
            projections[profileRef] = { workspaceRefs, sessions }
          }
        }
        accounts[accountId] = {
          ...(typeof source.displayName === 'string' ? { displayName: source.displayName } : {}),
          ...(typeof source.desktopRef === 'string' ? { desktopRef: source.desktopRef } : {}),
          runtimes,
          projections,
        }
      }
      this.state = { schemaVersion: 2, accounts }
      if (raw.schemaVersion !== 2) await this.persist(this.state)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控 Runtime 状态已损坏', false, {}, { cause: error })
      }
      this.state = emptyState()
      await this.persist(this.state)
    }
    return this.state
  }

  private async persist(state: PersistedRuntimeState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await securePrivateDirectory(directory)
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
    await securePrivateFile(temporary)
    await rename(temporary, this.path)
    await securePrivateFile(this.path)
    this.state = state
  }
}
