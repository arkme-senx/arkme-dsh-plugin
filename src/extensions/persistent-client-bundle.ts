import { arkmeClientContentDigest } from './client-owner.js'

interface PersistentClientSpec {
  extensionId: string
  version: string
  name: string
  code: string
  apiPath: string
  operation?: 'extensions.persistent.invoke' | 'extensions.bundle.invoke'
  identityKey?: 'extensionId' | 'packageName'
  clientContentDigest?: string
  wrapperVersion?: number
}

export const ARKME_CLIENT_WRAPPER_VERSION = 4

/** This function is serialized into each generated browser bundle. It must stay closure-free. */
function persistentClientFactory(requireModule: (id: string) => unknown, spec: PersistentClientSpec): unknown {
  const React = requireModule('react') as typeof import('react')
  class Styles {
    tags = new Set<HTMLStyleElement>()
    insert(css: string) {
      if (typeof css !== 'string') throw new Error('styles.insert(css) needs a CSS string')
      const tag = document.createElement('style')
      tag.dataset.arkmeExtension = spec.extensionId
      tag.textContent = css
      document.head.append(tag)
      this.tags.add(tag)
      return () => { this.tags.delete(tag); tag.remove() }
    }
    dispose() { for (const tag of this.tags) tag.remove(); this.tags.clear() }
  }
  const unavailable = (name: string) => (): never => { throw new Error(`${name} is unavailable in persistent Arkme extensions`) }
  const jsonValue = (value: unknown): unknown => value === undefined ? null : JSON.parse(JSON.stringify(value)) as unknown
  const callOperation = async (operation: string, params: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(spec.apiPath, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, params }),
    })
    const envelope = await response.json() as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
    if (!response.ok || envelope.ok !== true) {
      const error = new Error(envelope.error?.message ?? `Arkme Host returned HTTP ${String(response.status)}`) as Error & { code?: string }
      if (envelope.error?.code !== undefined) error.code = envelope.error.code
      throw error
    }
    return envelope.value
  }
  const identityKey = spec.identityKey ?? 'extensionId'
  const registryProperty = '__arkmeExtensionClientOwnersV2'
  type ClientLease = { instanceKey: string; generation: number; deactivate(): void }
  const browser = globalThis as typeof globalThis & {
    [registryProperty]?: Map<string, ClientLease>
  }
  const owners = browser[registryProperty] ?? new Map<string, ClientLease>()
  browser[registryProperty] = owners
  let clientInstanceKey = ''
  const reportFailure = (error: unknown): void => {
    const message = (error !== null && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : String(error)).trim().slice(0, 2_000)
    void callOperation('extensions.client.failure', {
      identityKey,
      extensionId: spec.extensionId,
      version: spec.version,
      clientInstanceKey,
      clientContentDigest: spec.clientContentDigest ?? '',
      kind: 'runtime-load-failed',
      message: message || 'extension client failed to load',
    }).catch(reportError => {
      console.error(`[arkme-extension:${spec.extensionId}] failed to report Client isolation`, reportError)
    })
  }
  let deactivateClient: (() => void) | undefined
  const callHost = async (method: string, args: unknown = null): Promise<unknown> => {
    try {
      return await callOperation(
        spec.operation ?? 'extensions.persistent.invoke',
        {
          ...(spec.identityKey === 'packageName'
            ? { packageName: spec.extensionId }
            : { extensionId: spec.extensionId, version: spec.version }),
          method,
          args: jsonValue(args),
        },
      )
    } catch (error) {
      if ((error as { code?: unknown }).code === 'extension-runtime-unavailable') {
        deactivateClient?.()
      }
      throw error
    }
  }
  const guardedService = (service: object, name: string): unknown => new Proxy(service, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown
        const guard = (resolved: unknown) => {
          if (resolved !== null && typeof resolved === 'object' && 'fiber' in resolved && 'root' in resolved) {
            throw new Error(`service "${name}" returned a forbidden Context`)
          }
          return resolved
        }
        return result instanceof Promise ? result.then(guard) : guard(result)
      }
    },
  })
  const guardedContext = (ctx: any): unknown => {
    const declared = new Set(Object.keys(ctx.fiber.inject))
    const verbs = new Set(['effect', 'on', 'once', 'provide', 'timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce'])
    const timerVerbs = new Set(['timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce'])
    const read = (name: string, declarationRequired: boolean): unknown => {
      if (declarationRequired && !declared.has(name)) throw new Error(`service "${name}" is not injected by this extension`)
      const service = ctx.get(name)
      if (service === null || (typeof service !== 'object' && typeof service !== 'function')) return service
      return guardedService(service, name)
    }
    return new Proxy({}, {
      get(_target, property) {
        if (property === 'get') return (name: string) => read(name, false)
        if (typeof property !== 'string') return undefined
        if (verbs.has(property)) return (...args: unknown[]) => {
          if (timerVerbs.has(property) && !declared.has('timer')) throw new Error('timer service is not injected')
          return Reflect.apply(ctx[property], ctx, args)
        }
        return read(property, true)
      },
      set() { throw new Error('persistent extension ctx is read-only') },
    })
  }
  return {
    name: `arkme-extension-client:${spec.extensionId}`,
    async apply(ctx: any) {
      const locationSearch = typeof document.location?.search === 'string' ? document.location.search : ''
      const embeddedHarness = locationSearch.split(/[?&]/).includes('arkme-harness-embed=1')
      if (embeddedHarness) return
      const styles = new Styles()
      const taggedConsole = {
        ...console,
        log: (...args: unknown[]) => console.log(`[arkme-extension:${spec.extensionId}]`, ...args),
        info: (...args: unknown[]) => console.info(`[arkme-extension:${spec.extensionId}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[arkme-extension:${spec.extensionId}]`, ...args),
        error: (...args: unknown[]) => console.error(`[arkme-extension:${spec.extensionId}]`, ...args),
      }
      let fiber: { dispose?(): unknown; then?: unknown } | undefined
      let deactivate: (() => void) | undefined
      let ownerKey = ''
      let lease: ClientLease | undefined
      let active = false
      try {
        const state = await callOperation(
          identityKey === 'packageName' ? 'extensions.bundle.client-state' : 'extensions.persistent.client-state',
          identityKey === 'packageName'
            ? {
                packageName: spec.extensionId,
                version: spec.version,
                clientContentDigest: spec.clientContentDigest ?? '',
              }
            : { extensionId: spec.extensionId, version: spec.version },
        ) as { mount?: boolean; extension_id?: unknown; instance_key?: unknown; generation?: unknown }
        if (state.mount !== true) return
        if (typeof state.extension_id !== 'string' || state.extension_id.trim() === ''
          || typeof state.instance_key !== 'string' || state.instance_key.trim() === ''
          || typeof state.generation !== 'number' || !Number.isSafeInteger(state.generation) || state.generation < 0) {
          throw new Error('Arkme Host returned an invalid Client owner lease')
        }
        ownerKey = state.extension_id.trim()
        clientInstanceKey = state.instance_key.trim()
        const generation = state.generation
        const current = owners.get(ownerKey)
        if (current !== undefined) {
          if (current.instanceKey === clientInstanceKey) {
            taggedConsole.warn(`Client instance ${clientInstanceKey} is already active; skipping duplicate mount`)
            return
          }
          if (current.generation >= generation) {
            taggedConsole.warn(`A newer Client instance for ${ownerKey} is already active; skipping stale mount`)
            return
          }
          current.deactivate()
        }
        active = true
        deactivate = () => {
          if (!active) return
          active = false
          styles.dispose()
          void Promise.resolve(fiber?.dispose?.()).catch(() => undefined)
        }
        lease = { instanceKey: clientInstanceKey, generation, deactivate }
        owners.set(ownerKey, lease)
        deactivateClient = deactivate
        ctx.effect(() => () => {
          deactivate?.()
          if (deactivateClient === deactivate) deactivateClient = undefined
          if (owners.get(ownerKey) === lease) owners.delete(ownerKey)
        }, `arkme-extension:${ownerKey}:client-lease`)
        const traps = {
          setTimeout: unavailable('setTimeout'), setInterval: unavailable('setInterval'),
          clearTimeout: unavailable('clearTimeout'), clearInterval: unavailable('clearInterval'),
          fetch: unavailable('fetch'), require: unavailable('require'),
        }
        const parameters = ['React', 'console', 'styles', 'host', 'harness', ...Object.keys(traps), 'process', 'Buffer']
        const closure = new Function(...parameters, `return (async () => {\n${spec.code}\n})()`)
        const harness = new Proxy({}, { get(_target, property) { throw new Error(`harness.${String(property)} belongs to the Host half`) } })
        const evaluated = await closure(
          React, taggedConsole, styles, { call: callHost }, harness, ...Object.values(traps), undefined, undefined,
        )
        if (!active || owners.get(ownerKey) !== lease) return
        const isFunction = typeof evaluated === 'function'
        if (!isFunction && (evaluated === null || typeof evaluated !== 'object' || typeof evaluated.apply !== 'function')) {
          throw new Error('persistent extension client code did not return a Cordis plugin')
        }
        const applyEvaluated = isFunction ? evaluated : evaluated.apply.bind(evaluated)
        const guarded = {
          ...(isFunction ? {} : evaluated),
          name: `arkme-extension-client:${spec.extensionId}`,
          apply(childCtx: unknown, config?: unknown) { return applyEvaluated(guardedContext(childCtx), config) },
        }
        fiber = ctx.plugin(guarded) as { dispose?(): unknown; then?: unknown }
        if (!active || owners.get(ownerKey) !== lease) {
          void Promise.resolve(fiber.dispose?.()).catch(() => undefined)
          return
        }
        await fiber
      } catch (error) {
        const authoritativeFailure = active && lease !== undefined && owners.get(ownerKey) === lease
        deactivate?.()
        styles.dispose()
        if (deactivateClient === deactivate) deactivateClient = undefined
        if (lease !== undefined && owners.get(ownerKey) === lease) owners.delete(ownerKey)
        taggedConsole.error('Client load failed and was isolated; DSH will continue without this extension', error)
        if (authoritativeFailure) reportFailure(error)
      }
    },
  }
}

export function renderPersistentClientBundle(packageName: string, spec: PersistentClientSpec): string {
  const renderedSpec: PersistentClientSpec = {
    ...spec,
    clientContentDigest: spec.clientContentDigest ?? arkmeClientContentDigest(spec.code),
    wrapperVersion: ARKME_CLIENT_WRAPPER_VERSION,
  }
  return [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {`,
    `  const __name = (target, value) => Object.defineProperty(target, 'name', { value, configurable: true })`,
    `  return (${persistentClientFactory.toString()})(require, ${JSON.stringify(renderedSpec)})`,
    `} })`,
    '',
  ].join('\n')
}

export function renderArkmeBundleClientBundle(packageName: string, spec: {
  version: string
  name: string
  code: string
  apiPath: string
}): string {
  return renderPersistentClientBundle(packageName, {
    extensionId: packageName,
    ...spec,
    operation: 'extensions.bundle.invoke',
    identityKey: 'packageName',
  })
}
