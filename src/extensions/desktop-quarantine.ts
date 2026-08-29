import { randomUUID } from 'node:crypto'
import { open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArkmeExtensionInstallStore } from './install-store.js'
import type { ArkmeInstalledExtension } from './types.js'

const QUARANTINE_DIRECTORY_NAME = 'desktop-extension-quarantine'
const RECEIPT_FILE_NAME = 'receipt.json'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const QUARANTINE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RUNTIME_RELEASE_PATTERN = /^electron-runtime-v1-[a-f0-9]{32}$/
const MAX_FAILURE_SUMMARY_LENGTH = 2_000
const MAX_FAILURE_TAIL_LENGTH = 16_384

export type DesktopRuntimeEnvironment = 'prod' | 'test'
export type DesktopExtensionQuarantinePhase = 'pending' | 'active' | 'restored' | 'resolved'

export interface DesktopExtensionQuarantineEntry {
  packageName: string
  dependencySpec: string
  originalBundleIndex: number
  synchronizedAtMillis?: number
  notificationDismissedAtMillis?: number
  reenableRequestedAtMillis?: number
  resolvedAtMillis?: number
}

export interface DesktopExtensionQuarantineReceipt {
  schemaVersion: 1
  quarantineId: string
  environment: DesktopRuntimeEnvironment
  phase: DesktopExtensionQuarantinePhase
  mode: 'targeted' | 'local-safe-mode'
  createdAtMillis: number
  updatedAtMillis: number
  runtimeReleaseId?: string
  failureSummary: string
  failureLogTail: string
  entries: DesktopExtensionQuarantineEntry[]
}

export interface ArkmeDesktopQuarantineEntryView {
  packageName: string
  extensionId?: string
  dismissed: boolean
  resolved: boolean
}

export interface ArkmeDesktopQuarantineStatus {
  active: boolean
  quarantineId?: string
  mode?: 'targeted' | 'local-safe-mode'
  failureSummary?: string
  failureLogTail?: string
  entries: ArkmeDesktopQuarantineEntryView[]
}

interface InstallStoreLike {
  list(): ArkmeInstalledExtension[]
  get(extensionId: string): ArkmeInstalledExtension | undefined
  put(item: ArkmeInstalledExtension): void
}

interface ArkmeDesktopExtensionQuarantineOptions {
  dshHome: string
  environment: DesktopRuntimeEnvironment
  installStore: Pick<ArkmeExtensionInstallStore, 'list' | 'get' | 'put'> | InstallStoreLike
  setProfileEnabled(packageName: string, enabled: boolean): Promise<void>
  requestRestart(input: { packageName: string; previousProfileIncluded: false }): Promise<void>
  isPackageActive(packageName: string): boolean
  now?: () => number
}

interface StoredReceipt {
  path: string
  receipt: DesktopExtensionQuarantineReceipt
}

export class ArkmeDesktopExtensionQuarantine {
  private readonly now: () => number

  constructor(private readonly options: ArkmeDesktopExtensionQuarantineOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  async reconcile(): Promise<void> {
    for (const stored of await this.readReceipts('active')) {
      let changed = false
      for (const entry of stored.receipt.entries) {
        if (entry.resolvedAtMillis !== undefined) continue
        const installed = this.installedByPackage(entry.packageName)
        if (installed !== undefined && (installed.enabled
          || installed.active
          || installed.lastError !== stored.receipt.failureSummary)) {
          this.options.installStore.put({
            ...installed,
            enabled: false,
            active: false,
            lastError: stored.receipt.failureSummary,
          })
        }
        if (entry.synchronizedAtMillis === undefined) {
          entry.synchronizedAtMillis = this.now()
          changed = true
        }
      }
      if (changed) await this.writeStoredReceipt(stored)
    }
  }

  async status(): Promise<ArkmeDesktopQuarantineStatus> {
    const receipts = await this.readReceipts('active')
    const stored = receipts.sort((left, right) =>
      right.receipt.createdAtMillis - left.receipt.createdAtMillis)[0]
    if (stored === undefined) return { active: false, entries: [] }
    return {
      active: true,
      quarantineId: stored.receipt.quarantineId,
      mode: stored.receipt.mode,
      failureSummary: stored.receipt.failureSummary,
      failureLogTail: stored.receipt.failureLogTail,
      entries: stored.receipt.entries
        .filter(entry => entry.resolvedAtMillis === undefined)
        .map(entry => ({
          packageName: entry.packageName,
          ...(this.installedByPackage(entry.packageName) === undefined
            ? {}
            : { extensionId: this.installedByPackage(entry.packageName)!.extensionId }),
          dismissed: entry.notificationDismissedAtMillis !== undefined,
          resolved: false,
        })),
    }
  }

  async dismiss(packageName: string): Promise<void> {
    const stored = await this.activeReceiptForPackage(packageName)
    const entry = stored.receipt.entries.find(item => item.packageName === packageName)!
    if (entry.notificationDismissedAtMillis === undefined) {
      entry.notificationDismissedAtMillis = this.now()
      await this.writeStoredReceipt(stored)
    }
  }

  async reenable(packageName: string): Promise<void> {
    const stored = await this.activeReceiptForPackage(packageName)
    const entry = stored.receipt.entries.find(item => item.packageName === packageName)!
    entry.reenableRequestedAtMillis = this.now()
    await this.writeStoredReceipt(stored)
    let profileEnabled = false
    try {
      await this.options.setProfileEnabled(packageName, true)
      profileEnabled = true
      await this.options.requestRestart({ packageName, previousProfileIncluded: false })
    } catch (error) {
      if (profileEnabled) await this.options.setProfileEnabled(packageName, false).catch(() => undefined)
      delete entry.reenableRequestedAtMillis
      await this.writeStoredReceipt(stored).catch(() => undefined)
      throw error
    }
  }

  async resolveActive(): Promise<void> {
    for (const stored of await this.readReceipts('active')) {
      let changed = false
      for (const entry of stored.receipt.entries) {
        if (entry.resolvedAtMillis !== undefined) continue
        if (entry.reenableRequestedAtMillis !== undefined && this.options.isPackageActive(entry.packageName)) {
          entry.resolvedAtMillis = this.now()
          delete entry.reenableRequestedAtMillis
          const installed = this.installedByPackage(entry.packageName)
          if (installed !== undefined) {
            const { lastError: _lastError, ...retained } = installed
            this.options.installStore.put({ ...retained, enabled: true, active: true })
          }
          changed = true
          continue
        }
        if (entry.reenableRequestedAtMillis !== undefined) {
          await this.options.setProfileEnabled(entry.packageName, false)
          delete entry.reenableRequestedAtMillis
          const installed = this.installedByPackage(entry.packageName)
          if (installed !== undefined) {
            this.options.installStore.put({ ...installed, enabled: false, active: false })
          }
          changed = true
        }
      }
      if (stored.receipt.entries.every(entry => entry.resolvedAtMillis !== undefined)) {
        stored.receipt.phase = 'resolved'
        changed = true
      }
      if (changed) await this.writeStoredReceipt(stored)
    }
  }

  async health(packageName: string): Promise<{ profileEnabled: boolean; active: boolean }> {
    const stored = await this.activeReceiptForPackage(packageName)
    const entry = stored.receipt.entries.find(item => item.packageName === packageName)!
    if (entry.reenableRequestedAtMillis === undefined) {
      throw new Error('该扩展尚未请求重新启用')
    }
    const profileEnabled = await this.profileContains(packageName)
    const active = this.options.isPackageActive(packageName)
    if (profileEnabled && active) await this.resolveActive()
    return { profileEnabled, active }
  }

  private async activeReceiptForPackage(packageName: string): Promise<StoredReceipt> {
    if (!isPackageName(packageName) || isProtectedPackage(packageName)) {
      throw new Error('隔离扩展包名无效')
    }
    const matches = (await this.readReceipts('active')).filter(stored =>
      stored.receipt.entries.some(entry =>
        entry.packageName === packageName && entry.resolvedAtMillis === undefined))
    matches.sort((left, right) => right.receipt.createdAtMillis - left.receipt.createdAtMillis)
    if (matches[0] === undefined) throw new Error('该扩展没有活动的启动隔离记录')
    return matches[0]
  }

  private installedByPackage(packageName: string): ArkmeInstalledExtension | undefined {
    return this.options.installStore.list().find(item => item.profilePackageName === packageName)
  }

  private async profileContains(packageName: string): Promise<boolean> {
    try {
      const value = JSON.parse(await readFile(join(
        this.options.dshHome,
        'profiles',
        'web',
        'package.json',
      ), 'utf8')) as unknown
      if (!isObject(value) || !isObject(value.dsh) || !isObject(value.dsh.profile)
        || !Array.isArray(value.dsh.profile.bundles)) return false
      return value.dsh.profile.bundles.some(item => item === packageName)
    } catch {
      return false
    }
  }

  private async readReceipts(phase?: DesktopExtensionQuarantinePhase): Promise<StoredReceipt[]> {
    const root = join(this.options.dshHome, 'arkme-self', QUARANTINE_DIRECTORY_NAME)
    const directories = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const receipts: StoredReceipt[] = []
    for (const directory of directories) {
      if (!directory.isDirectory() || !QUARANTINE_ID_PATTERN.test(directory.name)) continue
      const receiptPath = join(root, directory.name, RECEIPT_FILE_NAME)
      try {
        const receipt = parseReceipt(await readFile(receiptPath, 'utf8'))
        if (receipt.quarantineId !== directory.name
          || receipt.environment !== this.options.environment
          || (phase !== undefined && receipt.phase !== phase)) continue
        receipts.push({ path: receiptPath, receipt })
      } catch {
        // A malformed shell receipt is untrusted input and never authorizes state or Profile changes.
      }
    }
    return receipts
  }

  private async writeStoredReceipt(stored: StoredReceipt): Promise<void> {
    stored.receipt.updatedAtMillis = this.now()
    await writeTextAtomically(stored.path, `${JSON.stringify(stored.receipt, undefined, 2)}\n`)
  }
}

export function parseDesktopExtensionQuarantineReceipt(text: string): DesktopExtensionQuarantineReceipt {
  return parseReceipt(text)
}

function parseReceipt(text: string): DesktopExtensionQuarantineReceipt {
  const value = JSON.parse(text) as unknown
  if (!isObject(value)
    || value.schemaVersion !== 1
    || typeof value.quarantineId !== 'string'
    || !QUARANTINE_ID_PATTERN.test(value.quarantineId)
    || (value.environment !== 'prod' && value.environment !== 'test')
    || !['pending', 'active', 'restored', 'resolved'].includes(String(value.phase))
    || (value.mode !== 'targeted' && value.mode !== 'local-safe-mode')
    || !Number.isSafeInteger(value.createdAtMillis)
    || !Number.isSafeInteger(value.updatedAtMillis)
    || (value.runtimeReleaseId !== undefined
      && (typeof value.runtimeReleaseId !== 'string' || !RUNTIME_RELEASE_PATTERN.test(value.runtimeReleaseId)))
    || typeof value.failureSummary !== 'string'
    || value.failureSummary.trim() === ''
    || value.failureSummary.length > MAX_FAILURE_SUMMARY_LENGTH
    || typeof value.failureLogTail !== 'string'
    || value.failureLogTail.length > MAX_FAILURE_TAIL_LENGTH
    || !Array.isArray(value.entries)
    || value.entries.length === 0) {
    throw new Error('桌面扩展隔离记录无效')
  }
  const entries = value.entries.map(raw => parseEntry(raw))
  if (new Set(entries.map(entry => entry.packageName)).size !== entries.length) {
    throw new Error('桌面扩展隔离记录包含重复扩展')
  }
  return {
    schemaVersion: 1,
    quarantineId: value.quarantineId,
    environment: value.environment,
    phase: value.phase as DesktopExtensionQuarantinePhase,
    mode: value.mode,
    createdAtMillis: Number(value.createdAtMillis),
    updatedAtMillis: Number(value.updatedAtMillis),
    ...(typeof value.runtimeReleaseId === 'string' ? { runtimeReleaseId: value.runtimeReleaseId } : {}),
    failureSummary: value.failureSummary,
    failureLogTail: value.failureLogTail,
    entries,
  }
}

function parseEntry(value: unknown): DesktopExtensionQuarantineEntry {
  if (!isObject(value)
    || typeof value.packageName !== 'string'
    || !isPackageName(value.packageName)
    || isProtectedPackage(value.packageName)
    || typeof value.dependencySpec !== 'string'
    || value.dependencySpec.length === 0
    || value.dependencySpec.length > 4_096
    || !Number.isSafeInteger(value.originalBundleIndex)
    || Number(value.originalBundleIndex) < 0
    || !optionalMillis(value.synchronizedAtMillis)
    || !optionalMillis(value.notificationDismissedAtMillis)
    || !optionalMillis(value.reenableRequestedAtMillis)
    || !optionalMillis(value.resolvedAtMillis)) {
    throw new Error('桌面扩展隔离条目无效')
  }
  return {
    packageName: value.packageName,
    dependencySpec: value.dependencySpec,
    originalBundleIndex: Number(value.originalBundleIndex),
    ...(value.synchronizedAtMillis === undefined
      ? {}
      : { synchronizedAtMillis: Number(value.synchronizedAtMillis) }),
    ...(value.notificationDismissedAtMillis === undefined
      ? {}
      : { notificationDismissedAtMillis: Number(value.notificationDismissedAtMillis) }),
    ...(value.reenableRequestedAtMillis === undefined
      ? {}
      : { reenableRequestedAtMillis: Number(value.reenableRequestedAtMillis) }),
    ...(value.resolvedAtMillis === undefined
      ? {}
      : { resolvedAtMillis: Number(value.resolvedAtMillis) }),
  }
}

function optionalMillis(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPackageName(value: string): boolean {
  return PACKAGE_NAME_PATTERN.test(value)
}

function isProtectedPackage(packageName: string): boolean {
  return packageName === '@senguoyun/dsh-arkme' || packageName.startsWith('@deepseek-ai/')
}

async function writeTextAtomically(filePath: string, text: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
