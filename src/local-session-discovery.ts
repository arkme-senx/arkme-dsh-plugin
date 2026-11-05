import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, opendir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'
import { SharedReadGroup } from './shared-read-group.js'

type Json = Record<string, unknown>
export type LocalHistoryIdentity = { accountId: string; environment: 'test' | 'prod'; runtimeRef: string; sessionRef: string; previousRuntimeRefs?: readonly string[]; sourceProfileRef?: string }
/** Host-only location. Never serialize this into Browser, SDK or Tool output. */
export type LocalHistorySource = { dshHome: string; runtimeRef: string; sessionRef: string }
export type DiscoveryLimits = { directories: number; depth: number; sources: number; jsonBytes: number }
const DEFAULT_LIMITS: DiscoveryLimits = { directories: 25_000, depth: 10, sources: 256, jsonBytes: 4 * 1024 * 1024 }
const SKIP = new Set(['node_modules', 'vendor', 'Pods', 'build', 'dist', 'target', 'Cache', 'Caches', 'Code Cache', 'GPUCache', 'DerivedData', 'runtime-manager', 'runtime-data-transactions', 'codex-backups', 'backups', 'sessions', 'attachments', 'dsh-containers'])
const APPLICATION_LAYOUTS = new Set(['Arkme Harness', 'Arkme Harness Test', 'artifacts', 'app-data'])
const DISCOVERY_MARKERS = ['.git', 'dsh-account-scopes.json', 'arkme-self', ...APPLICATION_LAYOUTS]
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const missing = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code))
const validRef = (ref: string) => /^[A-Za-z0-9_.:-]{1,256}$/.test(ref) && ref !== '.' && ref !== '..'
// Validate the desktop's published V1 registry, not a loose copy of its owner field.
function registeredContainer(registry: Json | undefined, ref: string): Json | undefined {
  if (registry?.version !== 1 || typeof registry.activeContainerRef !== 'string' || !registry.accounts || Array.isArray(registry.accounts)) return
  const containers = object(registry.containers), active = object(containers[registry.activeContainerRef]), activeOwner = object(active.owner)
  if (!Object.keys(active).length || activeOwner.kind === 'account' && object(registry.accounts)[String(activeOwner.accountRef)] !== registry.activeContainerRef) return
  const container = object(containers[ref]), owner = object(container.owner)
  if (owner.kind !== 'account' || !/^[a-f0-9]{64}$/u.test(String(owner.accountRef))
    || !Number.isSafeInteger(container.createdAtMillis) || Number(container.createdAtMillis) <= 0
    || !Number.isSafeInteger(container.updatedAtMillis) || Number(container.updatedAtMillis) <= 0) return
  return container
}
export function localHistoryAccountRef(accountId: string): string {
  if (!/^[1-9]\d{0,19}$/.test(accountId)) throw new Error('本机历史账号无效')
  return createHash('sha256').update(`arkme-dsh-account-scope-v1\n${accountId}`).digest('hex')
}

/** Filename discovery, never content search or a recursive read of user documents. */
export class LocalSessionDiscovery {
  private readonly limits: DiscoveryLimits
  private readonly known = new Set<string>()
  private readonly flights = new SharedReadGroup<void>()
  private knownCheckedAt = 0
  private readonly inventories = new Map<string, { expires: number; sources: number; entries: Map<string, Set<string>> }>()
  private scanned = false
  private limited = false
  /** Inventory coverage is independent of whether a particular journal exists. */
  get inventoryState(): 'idle' | 'complete' | 'limited' { return !this.scanned ? 'idle' : this.limited ? 'limited' : 'complete' }
  constructor(private readonly options: {
    userHome: string; indexRoot: string; dataRoots: readonly string[]; searchRoots: readonly string[]
    limits?: Partial<DiscoveryLimits>
  }) { this.limits = { ...DEFAULT_LIMITS, ...options.limits } }

  close(): void { this.flights.clear(); this.known.clear(); this.inventories.clear() }

  private async json(path: string): Promise<Json | undefined> {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      if ((await lstat(path)).isSymbolicLink()) return
      handle = await open(path, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > this.limits.jsonBytes) return
      const bytes = Buffer.alloc(stat.size + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > stat.size) return
      return object(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')))
    } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error }
    finally { await handle?.close() }
  }

  private async safeDirectory(path: string): Promise<string | undefined> {
    if (!isAbsolute(path)) return
    const home = await realpath(this.options.userHome), normalized = resolve(path)
    const relativePath = relative(normalized.startsWith(`${home}${sep}`) ? home : resolve(this.options.userHome), normalized)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return
    let current = home
    try {
      for (const part of relativePath.split(sep)) {
        current = join(current, part)
        const stat = await lstat(current)
        if (!stat.isDirectory() || stat.isSymbolicLink()) return
      }
      return current
    } catch (error) { if (!missing(error)) throw error }
  }

  /** Future instances register themselves once; registration contains no credentials. */
  async register(dshHome: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const path = await this.safeDirectory(dshHome)
    if (!path) throw new Error('本机历史目录不属于当前用户或包含符号链接')
    await mkdir(this.options.indexRoot, { recursive: true, mode: 0o700 })
    if (!await this.safeDirectory(this.options.indexRoot)) throw new Error('本机实例索引目录无效')
    await securePrivateDirectory(this.options.indexRoot)
    const id = createHash('sha256').update(path).digest('hex')
    const target = join(this.options.indexRoot, `${id}.json`), temp = `${target}.${randomUUID()}.tmp`
    const existing = await this.json(target)
    if (existing?.version === 1 && existing.dshHome === path) { this.known.add(path); return }
    let count = 0
    for await (const entry of await opendir(this.options.indexRoot)) if (entry.name.endsWith('.json') && ++count >= this.limits.sources) { this.limited = true; return }
    try {
      await writeFile(temp, JSON.stringify({ version: 1, dshHome: path }), { flag: 'wx', mode: 0o600 })
      await securePrivateFile(temp)
      signal.throwIfAborted()
      await rename(temp, target)
      this.known.add(path)
    } finally { await unlink(temp).catch(error => { if (!missing(error)) throw error }) }
  }

  private async registered(signal: AbortSignal): Promise<void> {
    const root = await this.safeDirectory(this.options.indexRoot)
    if (!root) return
    let count = 0
    for await (const file of await opendir(root)) {
      signal.throwIfAborted()
      if (!file.isFile() || !/^[a-f0-9]{64}\.json$/.test(file.name)) continue
      if (++count > this.limits.sources) { this.limited = true; break }
      const item = await this.json(join(root, file.name))
      const home = item?.version === 1 && typeof item.dshHome === 'string' ? await this.safeDirectory(item.dshHome) : undefined
      if (home) this.known.add(home)
    }
  }

  private async containers(root: string, signal: AbortSignal): Promise<void> {
    // Account containers can coexist with the pre-container journal layout.
    for (const legacy of [root, join(root, 'dsh')]) {
      if (await this.safeDirectory(join(legacy, 'arkme-self'))) await this.remember(legacy)
    }
    const registry = await this.json(join(root, 'dsh-account-scopes.json'))
    if (registry?.version !== 1) return
    for (const [ref, value] of Object.entries(object(registry.containers))) {
      signal.throwIfAborted()
      if (!/^scope_[A-Za-z0-9_-]{3,120}$/.test(ref) || !registeredContainer(registry, ref)) continue
      const home = await this.safeDirectory(join(root, 'dsh-containers', ref, 'dsh'))
      if (home) {
        if (this.known.size >= this.limits.sources && !this.known.has(home)) { this.limited = true; return }
        this.known.add(home)
      }
    }
  }

  private async remember(home: string): Promise<void> {
    const path = await this.safeDirectory(home)
    if (!path) return
    if (this.known.size >= this.limits.sources && !this.known.has(path)) { this.limited = true; return }
    this.known.add(path)
  }

  private scopedProfile(home: string, profile: string): boolean {
    const scope = basename(dirname(home))
    return basename(home) === 'dsh' && /^scope_[A-Za-z0-9_-]{3,120}$/.test(scope)
      && profile.endsWith(`:${scope}`)
  }

  private async ownsSession(home: string, identity: LocalHistoryIdentity): Promise<boolean> {
    const profile = identity.sourceProfileRef
    if (!profile || !this.scopedProfile(home, profile)) return false
    const key = createHash('sha256').update(`dsh-remote-session-ownership-v1\n${profile}`).digest('base64url')
    const directory = join(home, 'arkme-self', identity.environment, 'dsh-remote', 'session-ownership')
    if (!await this.safeDirectory(directory)) return false
    const state = await this.json(join(directory, `${key}.json`)), owner = object(object(state?.sessions)[identity.sessionRef])
    return state?.schemaVersion === 1 && state.profileRef === profile && owner.ownerAccountId === identity.accountId
      && Number.isSafeInteger(owner.claimedAtMillis) && Number(owner.claimedAtMillis) > 0
      && ['existing-at-login', 'observed-while-active', 'remote-create'].includes(String(owner.origin))
  }

  private async scan(signal: AbortSignal, maxDepth: number): Promise<void> {
    const seen = new Set<string>(), pending: { path: string; depth: number; applicationData?: boolean }[] = []
    let inspected = 0
    const enqueue = (item: typeof pending[number]) => {
      if (seen.has(item.path)) return
      if (pending.length >= this.limits.directories) {
        this.limited = true
        const replace = item.applicationData ? pending.findLastIndex(value => !value.applicationData) : -1
        if (replace < 0) return
        seen.delete(pending[replace]!.path); pending.splice(replace, 1)
      }
      seen.add(item.path)
      pending.push(item)
    }
    for (const root of this.options.searchRoots) {
      const path = resolve(root)
      if (path === resolve(this.options.userHome) || await this.safeDirectory(path)) enqueue({ path, depth: 0 })
    }
    // The shell already supplies platform data roots. Search their siblings for
    // alternate app names; on macOS also inspect only the app-data leaf of each sandbox.
    for (const root of this.options.dataRoots) {
      const parent = await this.safeDirectory(dirname(root))
      if (parent) enqueue({ path: parent, depth: 0, applicationData: true })
    }
    const containers = await this.safeDirectory(join(this.options.userHome, 'Library', 'Containers'))
    if (containers) {
      let count = 0
      try {
        for await (const entry of await opendir(containers)) {
          signal.throwIfAborted()
          if (++count > this.limits.directories) { this.limited = true; break }
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue
          const path = await this.safeDirectory(join(containers, entry.name, 'Data', 'Library', 'Application Support'))
          if (path) enqueue({ path, depth: 0, applicationData: true })
        }
      } catch (error) { if (!missing(error)) throw error }
    }
    while (pending.length && inspected < this.limits.directories) {
      signal.throwIfAborted()
      // Spend the I/O budget on registered application layouts before ordinary directories.
      const batch: typeof pending = []
      for (let i = 0; i < 8 && pending.length && inspected + batch.length < this.limits.directories; i++) {
        const next = pending.findIndex(item => !!item.applicationData === (i % 2 === 0))
        batch.push(...pending.splice(Math.max(0, next), 1))
      }
      inspected += batch.length
      const results = await Promise.allSettled(batch.map(async ({ path, depth, applicationData }) => {
        const entries: Pick<import('node:fs').Dirent, 'name' | 'isDirectory' | 'isFile' | 'isSymbolicLink'>[] = []
        let enumerated = 0, truncated = false
        try {
          for await (const entry of await opendir(path)) {
            signal.throwIfAborted()
            if (entry.isDirectory() || entry.name === '.git' || entry.name === 'dsh-account-scopes.json') entries.push(entry)
            if (++enumerated >= this.limits.directories) { this.limited = true; truncated = true; break }
          }
        }
        catch (error) { if (missing(error)) return; throw error }
        if (truncated) {
          // Enumeration order is unspecified. Probe only these fixed names so a
          // truncated listing cannot hide an application layout or safety marker.
          for (const name of DISCOVERY_MARKERS) {
            signal.throwIfAborted()
            if (entries.some(entry => entry.name === name)) continue
            try {
              const stat = await lstat(join(path, name))
              entries.push({ name, isDirectory: () => stat.isDirectory(), isFile: () => stat.isFile(), isSymbolicLink: () => stat.isSymbolicLink() })
            } catch (error) { if (!missing(error)) throw error }
          }
        }
        signal.throwIfAborted()
        if (entries.some(entry => entry.name === 'dsh-account-scopes.json' && entry.isFile())) {
          const registry = await this.json(join(path, 'dsh-account-scopes.json'))
          if (registry?.version === 1) await this.containers(path, signal)
        }
        if (entries.some(entry => entry.name === 'arkme-self' && entry.isDirectory() && !entry.isSymbolicLink())) {
          await this.remember(path)
          return
        }
        if (depth >= maxDepth) return
        const repository = entries.some(entry => entry.name === '.git')
        for (const entry of entries) {
          signal.throwIfAborted()
          if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || SKIP.has(entry.name)
            || entry.name === 'Library' || entry.name === 'AppData') continue
          // Development launchers also nest registered app data under their artifact root.
          const applicationRoot = APPLICATION_LAYOUTS.has(entry.name)
          if (repository && !applicationRoot) continue
          enqueue({ path: join(path, entry.name), depth: depth + 1, applicationData: applicationData || applicationRoot })
        }
      }))
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    if (pending.length) this.limited = true
  }

  private async sourceAccount(home: string, identity: LocalHistoryIdentity, signal: AbortSignal): Promise<Json | undefined> {
    signal.throwIfAborted()
    if (!await this.safeDirectory(home)) return
    const registryRoot = basename(dirname(home)).startsWith('scope_') ? dirname(dirname(dirname(home))) : undefined
    if (registryRoot) {
      const registry = await this.json(join(registryRoot, 'dsh-account-scopes.json'))
      const owner = object(registeredContainer(registry, basename(dirname(home)))?.owner)
      if (owner.kind !== 'account' || owner.accountRef !== localHistoryAccountRef(identity.accountId)) return
    }
    const directory = await this.safeDirectory(join(home, 'arkme-self', identity.environment, 'dsh-remote'))
    if (!directory) return
    const state = await this.json(join(directory, 'runtime-state.json'))
    return state?.schemaVersion === 2 ? object(object(state.accounts)[identity.accountId]) : undefined
  }

  private async matches(identity: LocalHistoryIdentity, signal: AbortSignal): Promise<LocalHistorySource[]> {
    const scope = JSON.stringify([identity.accountId, identity.environment])
    const cached = this.inventories.get(scope)
    if (!cached || cached.expires <= Date.now() || cached.sources !== this.known.size) {
      await this.flights.run(`identities:${scope}`, async (shared, current) => {
        const sources = this.known.size, entries = new Map<string, Set<string>>()
        for (const home of this.known) {
          const account = await this.sourceAccount(home, identity, shared)
          if (!account) continue
          for (const profile of Object.keys(object(account.runtimes))) {
            if (!this.scopedProfile(home, profile)) continue
            const key = JSON.stringify(['profile', profile])
            if (!entries.has(key) && entries.size >= 10_000) { this.limited = true; continue }
            const homes = entries.get(key) ?? new Set<string>()
            homes.add(home); entries.set(key, homes)
          }
          for (const [profile, inventory] of Object.entries(object(account.projections))) {
            const runtime = object(object(account.runtimes)[profile]).runtimeRef
            if (typeof runtime !== 'string' || !validRef(runtime)) continue
            const sessions = object(inventory).sessions
            if (!Array.isArray(sessions)) continue
            for (const row of sessions) {
              const session = object(row).sessionRef
              if (typeof session !== 'string' || !validRef(session)) continue
              const key = JSON.stringify([runtime, session])
              if (!entries.has(key) && entries.size >= 10_000) { this.limited = true; continue }
              const homes = entries.get(key) ?? new Set<string>(); homes.add(home); entries.set(key, homes)
            }
          }
        }
        if (current()) {
          if (!this.inventories.has(scope) && this.inventories.size >= 4) this.inventories.delete(this.inventories.keys().next().value!)
          this.inventories.set(scope, { expires: Date.now() + 30_000, sources, entries })
        }
      }, signal)
    }
    const matches: LocalHistorySource[] = []
    // The index is a location hint, never an authorization cache.
    const runtimes = new Set([identity.runtimeRef, ...identity.previousRuntimeRefs ?? []])
    const homes = new Set([...runtimes].flatMap(runtime => [...this.inventories.get(scope)?.entries.get(JSON.stringify([runtime, identity.sessionRef])) ?? []]))
    for (const home of homes) {
      const account = await this.sourceAccount(home, identity, signal)
      if (!account) continue
      for (const [profile, inventory] of Object.entries(object(account.projections))) {
        const runtime = object(object(account.runtimes)[profile]).runtimeRef
        if (typeof runtime !== 'string' || !runtimes.has(runtime)) continue
        const sessions = object(inventory).sessions
        if (Array.isArray(sessions) && sessions.some(row => object(row).sessionRef === identity.sessionRef)) { matches.push({ dshHome: home, runtimeRef: runtime, sessionRef: identity.sessionRef }); break }
      }
    }
    // Mutable runtime projections are discovery hints. Permanent account ownership
    // plus an authenticated scoped Profile can recover a missing/rotated projection.
    if (identity.sourceProfileRef) for (const home of this.inventories.get(scope)?.entries.get(JSON.stringify(['profile', identity.sourceProfileRef])) ?? []) {
      signal.throwIfAborted()
      if (matches.some(source => source.dshHome === home)) continue
      if (await this.sourceAccount(home, identity, signal) && await this.ownsSession(home, identity)) {
        matches.push({ dshHome: home, runtimeRef: identity.runtimeRef, sessionRef: identity.sessionRef })
      }
    }
    signal.throwIfAborted()
    return matches
  }

  async prepare(signal: AbortSignal): Promise<void> {
    if (!this.scanned) await this.flights.run('legacy-inventory', async (shared, current) => {
      this.limited = false
      await this.scan(shared, this.limits.depth)
      for (const home of this.known) await this.register(home, shared)
      if (current()) this.scanned = true
    }, signal)
  }

  async find(identity: LocalHistoryIdentity, signal: AbortSignal, scope: 'registered' | 'all' = 'all'): Promise<LocalHistorySource[]> {
    localHistoryAccountRef(identity.accountId)
    if (!['test', 'prod'].includes(identity.environment) || !validRef(identity.runtimeRef) || !validRef(identity.sessionRef) || (identity.previousRuntimeRefs?.length ?? 0) > 256 || identity.previousRuntimeRefs?.some(ref => !validRef(ref)) || identity.sourceProfileRef !== undefined && !validRef(identity.sourceProfileRef)) throw new Error('本机历史查询身份无效')
    if (Date.now() >= this.knownCheckedAt) await this.flights.run('registered-locations', async (shared, current) => {
      await this.registered(shared)
      for (const root of this.options.dataRoots) if (await this.safeDirectory(root)) await this.containers(root, shared)
      if (current()) this.knownCheckedAt = Date.now() + 5_000
    }, signal)
    let found = await this.matches(identity, signal)
    if (found.length || scope === 'registered') return found
    // Inventory work belongs to the discovery scope, not each missing session.
    // Exhaustion is incomplete coverage; it must not block an existing cloud read.
    await this.prepare(signal)
    signal.throwIfAborted()
    return this.matches(identity, signal)
  }
}
