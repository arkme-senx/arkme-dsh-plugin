import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

interface ArkmeCordisSource {
  format: 'arkme-cordis-source'
  formatVersion: 1
  name: string
  description: string
  hostCode?: string
  clientCode?: string
}

type BundleHandler = (args: unknown) => unknown | Promise<unknown>
const bundleHandlers = new Map<string, Map<string, BundleHandler>>()
const bundleFibers = new Map<string, Fiber>()
const VM_TIMEOUT_MS = 5_000

function readSource(url: URL): ArkmeCordisSource {
  const value = JSON.parse(readFileSync(url, 'utf8')) as Partial<ArkmeCordisSource>
  if (value.format !== 'arkme-cordis-source' || value.formatVersion !== 1
    || typeof value.name !== 'string' || typeof value.description !== 'string'
    || (value.hostCode !== undefined && typeof value.hostCode !== 'string')
    || (value.clientCode !== undefined && typeof value.clientCode !== 'string')) {
    throw new Error('Arkme Bundle source descriptor is invalid')
  }
  return value as ArkmeCordisSource
}

function safePackageName(value: string): string {
  const normalized = value.trim()
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error('Arkme Bundle package name is invalid')
  }
  return normalized
}

function jsonValue(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value)) as unknown
}

function evaluateHost(code: string, packageName: string, handle: (method: unknown, fn: unknown) => () => void): Promise<unknown> {
  const unavailable = (name: string) => (): never => { throw new Error(`${name} is unavailable in Arkme sandboxed Bundles`) }
  const sandbox = {
    console: {
      log: (...args: unknown[]) => { console.log(`[arkme-bundle:${packageName}]`, ...args) },
      info: (...args: unknown[]) => { console.info(`[arkme-bundle:${packageName}]`, ...args) },
      warn: (...args: unknown[]) => { console.warn(`[arkme-bundle:${packageName}]`, ...args) },
      error: (...args: unknown[]) => { console.error(`[arkme-bundle:${packageName}]`, ...args) },
    },
    defineTool,
    harness: Object.freeze({ handle }),
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
    name: `arkme-bundle:${packageName}`,
    codeGeneration: { strings: false, wasm: false },
  })
  return Promise.resolve(runInContext(`(async () => {\n${code}\n})()`, sandbox, {
    timeout: VM_TIMEOUT_MS,
    filename: `arkme-bundle:${packageName}:host.js`,
  }))
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
    if (declarationRequired && !declared.has(name)) throw new Error(`service "${name}" is not injected by this Bundle`)
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
    set() { throw new Error('Arkme Bundle ctx is read-only') },
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

export async function applyArkmeBundleHostExtension(ctx: Context, sourceUrl: URL, packageNameValue: string): Promise<void> {
  const packageName = safePackageName(packageNameValue)
  const source = readSource(sourceUrl)
  if (source.hostCode === undefined) return
  const handlers = new Map<string, BundleHandler>()
  bundleHandlers.set(packageName, handlers)
  const handle = (methodValue: unknown, fnValue: unknown): (() => void) => {
    const method = typeof methodValue === 'string' ? methodValue.trim() : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(method) || typeof fnValue !== 'function') {
      throw new Error('harness.handle(method, fn) received invalid arguments')
    }
    const fn = fnValue as BundleHandler
    handlers.set(method, fn)
    return () => { if (handlers.get(method) === fn) handlers.delete(method) }
  }
  ctx.effect(() => () => {
    if (bundleHandlers.get(packageName) === handlers) bundleHandlers.delete(packageName)
  }, `arkme-bundle:${packageName}:handlers`)
  const evaluated = await evaluateHost(source.hostCode, packageName, handle)
  if (!pluginValue(evaluated)) throw new Error('Arkme Bundle host code did not return a Cordis plugin')
  const fiber = ctx.plugin(guardPlugin(evaluated))
  await fiber
  bundleFibers.set(packageName, fiber)
  ctx.effect(() => () => {
    if (bundleFibers.get(packageName) === fiber) bundleFibers.delete(packageName)
  }, `arkme-bundle:${packageName}:active-state`)
}

export function arkmeBundleActive(packageName: string): boolean {
  return bundleFibers.has(packageName)
}

export async function deactivateArkmeBundle(packageName: string): Promise<void> {
  const fiber = bundleFibers.get(packageName)
  if (fiber === undefined) return
  bundleFibers.delete(packageName)
  await fiber.dispose()
}

export async function invokeArkmeBundle(packageName: string, method: string, args: unknown): Promise<unknown> {
  const handler = bundleHandlers.get(packageName)?.get(method)
  if (handler === undefined) throw new Error('Arkme Bundle handler is unavailable')
  return jsonValue(await handler(jsonValue(args)))
}
