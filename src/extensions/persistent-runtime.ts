import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sha256Hex, unpackArkmeExtension } from './artifact.js'
import { verifyExtensionResolutionSignature } from './signature.js'
import type { ArkmeExtensionRealtimeFacade } from '../realtime/types.js'
import {
  ARKME_PERSISTENT_BUNDLE_FORMAT_VERSION, quarantinePersistentExtension,
  readPersistentExtensionActivation, type ArkmePersistentInstallation,
} from './persistent-bundle.js'

type PersistentHandler = (args: unknown) => unknown | Promise<unknown>
const persistentHandlers = new Map<string, Map<string, PersistentHandler>>()
interface PersistentRuntimeRegistration {
  ctx: Context
  installationUrl: URL
  fiber?: Fiber
  handlers?: Map<string, PersistentHandler>
  clientActivation?: object
  realtimeDisposers?: Set<() => void>
}
export interface PersistentArkmeExtensionRuntimeState {
  version: string
  installationUrl: string
  active: boolean
}
const persistentRegistrations = new Map<string, PersistentRuntimeRegistration>()
const persistentClientActivations = new Map<string, object>()
const VM_TIMEOUT_MS = 5_000

function readInstallation(url: URL): ArkmePersistentInstallation {
  const value = JSON.parse(readFileSync(url, 'utf8')) as ArkmePersistentInstallation
  if (value.format_version !== ARKME_PERSISTENT_BUNDLE_FORMAT_VERSION
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.extension_id)
    || value.version.trim() === '' || value.artifact_path.trim() === ''
    || value.trusted_public_key.trim() === '') {
    throw new Error('Arkme persistent extension installation metadata is invalid')
  }
  if (value.permissions !== undefined && (!Array.isArray(value.permissions)
    || !value.permissions.every(permission => typeof permission === 'string'))) {
    throw new Error('Arkme persistent extension effective permissions are invalid')
  }
  return {
    ...value,
    permissions: [...new Set((value.permissions ?? []).map(permission => permission.trim()).filter(Boolean))].sort(),
  }
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as unknown
}

function evaluateHost(
  code: string,
  extensionId: string,
  handle: (method: unknown, fn: unknown) => () => void,
  realtime: ArkmeExtensionRealtimeFacade,
): Promise<unknown> {
  const unavailable = (name: string) => (): never => { throw new Error(`${name} is unavailable in persistent Arkme extensions`) }
  const sandbox = {
    console: {
      log: (...args: unknown[]) => { console.log(`[arkme-extension:${extensionId}]`, ...args) },
      info: (...args: unknown[]) => { console.info(`[arkme-extension:${extensionId}]`, ...args) },
      warn: (...args: unknown[]) => { console.warn(`[arkme-extension:${extensionId}]`, ...args) },
      error: (...args: unknown[]) => { console.error(`[arkme-extension:${extensionId}]`, ...args) },
    },
    defineTool,
    harness: Object.freeze({ handle, realtime }),
    process: undefined,
    Buffer: undefined,
    require: unavailable('require'),
    fetch: unavailable('fetch'),
    setTimeout: unavailable('setTimeout'),
    setInterval: unavailable('setInterval'),
    clearTimeout: unavailable('clearTimeout'),
    clearInterval: unavailable('clearInterval'),
  }
  createContext(sandbox, {
    name: `arkme-persistent:${extensionId}`,
    codeGeneration: { strings: false, wasm: false },
  })
  return Promise.resolve(runInContext(`(async () => {\n${code}\n})()`, sandbox, {
    timeout: VM_TIMEOUT_MS,
    filename: `arkme-extension:${extensionId}:host.js`,
  }))
}

function scopedRealtimeFacade(
  ctx: Context,
  extensionId: string,
  permissions: readonly string[],
  disposers: Set<() => void>,
): ArkmeExtensionRealtimeFacade {
  if (!permissions.includes('realtime')) {
    return new Proxy({}, {
      get() { throw new Error('effective permission "realtime" is required for harness.realtime') },
    }) as ArkmeExtensionRealtimeFacade
  }
  const provider = ctx.get('arkmeRealtime') as { realtimeForExtension?(id: string): ArkmeExtensionRealtimeFacade } | null
  if (typeof provider?.realtimeForExtension !== 'function') {
    return new Proxy({}, {
      get() { throw new Error('Arkme realtime Host capability is unavailable') },
    }) as ArkmeExtensionRealtimeFacade
  }
  const facade = provider.realtimeForExtension(extensionId)
  const tracked = async (operation: Promise<() => void>): Promise<() => void> => {
    const dispose = await operation
    let active = true
    const release = () => {
      if (!active) return
      active = false
      disposers.delete(release)
      dispose()
    }
    disposers.add(release)
    return release
  }
  const scoped: ArkmeExtensionRealtimeFacade = {
    provide: async descriptor => await tracked(facade.provide(jsonValue(descriptor) as never)),
    invite: async input => jsonValue(await facade.invite(jsonValue(input) as never)) as never,
    enter: async (card, options) => jsonValue(await facade.enter(
      jsonValue(card) as never,
      options === undefined ? undefined : jsonValue(options) as never,
    )) as never,
    subscribe: async (channelRef, listener, options) => {
      if (typeof listener !== 'function') throw new Error('harness.realtime.subscribe needs an event listener')
      return await tracked(facade.subscribe(
        channelRef,
        event => { listener(jsonValue(event) as never) },
        options === undefined ? undefined : jsonValue(options) as never,
      ))
    },
    publish: async (session, payload, options) => jsonValue(await facade.publish(
      jsonValue(session) as never,
      jsonValue(payload),
      options === undefined ? undefined : jsonValue(options) as never,
    )) as never,
    close: async channelRef => jsonValue(await facade.close(channelRef)) as never,
  }
  return Object.freeze(scoped)
}

function disposeRealtimeResources(registration: PersistentRuntimeRegistration): void {
  for (const dispose of [...(registration.realtimeDisposers ?? [])]) {
    try { dispose() } catch { /* Extension teardown is best effort. */ }
  }
  registration.realtimeDisposers?.clear()
}

function pluginValue(value: unknown): value is Plugin {
  return typeof value === 'function'
    || (typeof value === 'object' && value !== null && typeof (value as { apply?: unknown }).apply === 'function')
}

function guardedService(value: object, name: string): unknown {
  return new Proxy(value, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown
        const guard = (resolved: unknown): unknown => {
          if (resolved instanceof Context) throw new Error(`service "${name}" returned a forbidden Context`)
          return resolved
        }
        return result instanceof Promise ? result.then(guard) : guard(result)
      }
    },
  })
}

function guardedContext(ctx: Context): Context {
  const declared = new Set(Object.keys(ctx.fiber.inject))
  const verbs = new Set(['effect', 'on', 'once', 'provide', 'timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce'])
  const timerVerbs = new Set(['timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce'])
  const read = (name: string, declarationRequired: boolean): unknown => {
    if (name === 'tools') {
      return {
        register: (tool: unknown) => ctx.tools.register(tool as Parameters<typeof ctx.tools.register>[0]),
        schemas: () => ctx.tools.schemas(ctx),
        get: (toolName: string) => ctx.tools.schemas(ctx).find(schema => schema.name === toolName),
      }
    }
    if (declarationRequired && !declared.has(name)) {
      throw new Error(`service "${name}" is not injected by this persistent extension`)
    }
    const service = ctx.get(name)
    if (service === null || (typeof service !== 'object' && typeof service !== 'function')) return service
    if (service instanceof Context) throw new Error(`service "${name}" resolved to a forbidden Context`)
    return guardedService(service, name)
  }
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'tools') return read('tools', false)
      if (property === 'get') return (name: string) => read(name, false)
      if (typeof property !== 'string') return undefined
      if (verbs.has(property)) {
        return (...args: unknown[]) => {
          if (timerVerbs.has(property) && !declared.has('timer')) throw new Error('timer service is not injected')
          return Reflect.apply(ctx[property as keyof Context] as (...values: unknown[]) => unknown, ctx, args)
        }
      }
      return read(property, true)
    },
    set() { throw new Error('persistent extension ctx is read-only') },
  }) as Context
}

function guardPlugin(plugin: Plugin): Plugin {
  if (typeof plugin === 'function') {
    const functionPlugin = plugin as (ctx: Context, config?: unknown) => unknown
    return { apply: (ctx: Context, config?: unknown) => functionPlugin(guardedContext(ctx), config) }
  }
  const objectPlugin = plugin as { apply(ctx: Context, config?: unknown): unknown }
  return { ...plugin, apply: (ctx: Context, config?: unknown) => objectPlugin.apply(guardedContext(ctx), config) }
}

async function mountPersistentArkmeHostExtension(
  installation: ArkmePersistentInstallation,
  registration: PersistentRuntimeRegistration,
): Promise<boolean> {
  if (registration.fiber !== undefined || registration.clientActivation !== undefined) return true
  const bytes = new Uint8Array(readFileSync(installation.artifact_path))
  if (sha256Hex(bytes) !== installation.artifact_sha256) throw new Error('persistent extension artifact checksum mismatch')
  const unpacked = unpackArkmeExtension(bytes)
  if (unpacked.manifestSha256 !== installation.manifest_sha256
    || unpacked.manifest.version !== installation.version) {
    throw new Error('persistent extension manifest mismatch')
  }
  verifyExtensionResolutionSignature({
    extension_id: installation.extension_id,
    version: installation.version,
    artifact_sha256: installation.artifact_sha256,
    manifest_sha256: installation.manifest_sha256,
    published_at: installation.published_at,
    signing_key_id: installation.signing_key_id,
    signature: installation.signature,
  }, new Map([[installation.signing_key_id, installation.trusted_public_key]]))
  if (unpacked.hostCode === undefined) {
    const activation = {}
    registration.ctx.effect(() => () => {
      if (persistentClientActivations.get(installation.extension_id) === activation) {
        persistentClientActivations.delete(installation.extension_id)
      }
      if (registration.clientActivation === activation) delete registration.clientActivation
    }, `arkme-extension:${installation.extension_id}:client-active-state`)
    persistentClientActivations.set(installation.extension_id, activation)
    registration.clientActivation = activation
    return true
  }
  const handlers = new Map<string, PersistentHandler>()
  const realtimeDisposers = new Set<() => void>()
  registration.realtimeDisposers = realtimeDisposers
  persistentHandlers.set(installation.extension_id, handlers)
  registration.handlers = handlers
  const handle = (methodValue: unknown, fnValue: unknown): (() => void) => {
    const method = typeof methodValue === 'string' ? methodValue.trim() : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(method) || typeof fnValue !== 'function') {
      throw new Error('harness.handle(method, fn) received invalid arguments')
    }
    const fn = fnValue as PersistentHandler
    handlers.set(method, fn)
    return () => { if (handlers.get(method) === fn) handlers.delete(method) }
  }
  try {
    const evaluated = await evaluateHost(
      unpacked.hostCode,
      installation.extension_id,
      handle,
      scopedRealtimeFacade(registration.ctx, installation.extension_id, installation.permissions ?? [], realtimeDisposers),
    )
    if (!pluginValue(evaluated)) throw new Error('persistent extension host.js did not return a Cordis plugin')
    const fiber = registration.ctx.plugin(guardPlugin(evaluated))
    await fiber
    registration.fiber = fiber
    return true
  } catch (error) {
    disposeRealtimeResources(registration)
    if (persistentHandlers.get(installation.extension_id) === handlers) persistentHandlers.delete(installation.extension_id)
    delete registration.handlers
    throw error
  }
}

function quarantineRuntimeFailure(
  installation: ArkmePersistentInstallation,
  installationUrl: URL,
  error: unknown,
): void {
  try {
    quarantinePersistentExtension(
      dirname(fileURLToPath(installationUrl)),
      installation.extension_id,
      error,
    )
  } catch (quarantineError) {
    console.error(`[arkme-extension:${installation.extension_id}] failed to persist quarantine state`, quarantineError)
  }
  console.error(`[arkme-extension:${installation.extension_id}] disabled after runtime load failure`, error)
}

export async function applyPersistentArkmeHostExtension(ctx: Context, installationUrl: URL): Promise<void> {
  let installation: ArkmePersistentInstallation
  try {
    installation = readInstallation(installationUrl)
  } catch (error) {
    console.error('[arkme-extension:unknown] ignored invalid persistent installation metadata', error)
    return
  }
  const previous = persistentRegistrations.get(installation.extension_id)
  if (previous?.ctx === ctx && previous.installationUrl.href === installationUrl.href) return
  if (previous !== undefined) {
    await deactivatePersistentArkmeExtension(installation.extension_id)
  }
  const registration: PersistentRuntimeRegistration = { ctx, installationUrl }
  persistentRegistrations.set(installation.extension_id, registration)
  try {
    ctx.effect(() => () => {
      if (persistentRegistrations.get(installation.extension_id) !== registration) return
      persistentRegistrations.delete(installation.extension_id)
      persistentHandlers.delete(installation.extension_id)
      disposeRealtimeResources(registration)
    }, `arkme-extension:${installation.extension_id}:registration`)
    ctx.effect(() => () => {
      if (persistentHandlers.get(installation.extension_id) === registration.handlers) {
        persistentHandlers.delete(installation.extension_id)
      }
    }, `arkme-extension:${installation.extension_id}:handlers`)
    const activation = readPersistentExtensionActivation(installationUrl)
    if (activation.extension_id !== installation.extension_id) {
      throw new Error('Arkme persistent extension activation identity mismatch')
    }
    if (!activation.enabled) return
    await mountPersistentArkmeHostExtension(installation, registration)
  } catch (error) {
    if (persistentRegistrations.get(installation.extension_id) === registration) {
      persistentRegistrations.delete(installation.extension_id)
      if (persistentHandlers.get(installation.extension_id) === registration.handlers) {
        persistentHandlers.delete(installation.extension_id)
      }
      if (persistentClientActivations.get(installation.extension_id) === registration.clientActivation) {
        persistentClientActivations.delete(installation.extension_id)
      }
    }
    quarantineRuntimeFailure(installation, installationUrl, error)
  }
}

export function persistentArkmeExtensionActive(extensionId: string): boolean {
  return persistentRegistrations.get(extensionId)?.fiber !== undefined || persistentClientActivations.has(extensionId)
}

export function persistentArkmeExtensionHandles(extensionId: string, method: string): boolean {
  return persistentHandlers.get(extensionId)?.has(method) === true
}

export function persistentArkmeExtensionRuntimeState(
  extensionId: string,
): PersistentArkmeExtensionRuntimeState | undefined {
  const registration = persistentRegistrations.get(extensionId)
  if (registration === undefined) return undefined
  try {
    const installation = readInstallation(registration.installationUrl)
    return {
      version: installation.version,
      installationUrl: registration.installationUrl.href,
      active: registration.fiber !== undefined || registration.clientActivation !== undefined,
    }
  } catch {
    return undefined
  }
}

/** Re-mount a verified Host half when its wrapper is already present in the current DSH process. */
export async function activatePersistentArkmeExtension(extensionId: string): Promise<boolean> {
  const registration = persistentRegistrations.get(extensionId)
  if (registration === undefined) return false
  const installation = readInstallation(registration.installationUrl)
  try {
    return await mountPersistentArkmeHostExtension(installation, registration)
  } catch (error) {
    quarantineRuntimeFailure(installation, registration.installationUrl, error)
    throw error
  }
}

export async function deactivatePersistentArkmeExtension(extensionId: string): Promise<void> {
  const registration = persistentRegistrations.get(extensionId)
  persistentClientActivations.delete(extensionId)
  if (registration === undefined) return
  delete registration.clientActivation
  if (registration.fiber === undefined) return
  const fiber = registration.fiber
  delete registration.fiber
  persistentHandlers.delete(extensionId)
  disposeRealtimeResources(registration)
  delete registration.handlers
  await fiber.dispose()
}

export async function invokePersistentArkmeExtension(
  extensionId: string,
  method: string,
  args: unknown,
): Promise<unknown> {
  const handler = persistentHandlers.get(extensionId)?.get(method)
  if (handler === undefined) throw new Error('persistent extension handler is unavailable')
  return jsonValue(await handler(jsonValue(args)))
}
