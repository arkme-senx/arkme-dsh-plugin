interface PersistentClientSpec {
  extensionId: string
  version: string
  name: string
  code: string
  apiPath: string
  operation?: 'extensions.persistent.invoke' | 'extensions.bundle.invoke'
  identityKey?: 'extensionId' | 'packageName'
}

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
  const callHost = async (method: string, args: unknown = null): Promise<unknown> => {
    const response = await fetch(spec.apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: spec.operation ?? 'extensions.persistent.invoke',
        params: {
          ...(spec.identityKey === 'packageName' ? { packageName: spec.extensionId } : { extensionId: spec.extensionId }),
          method,
          args: jsonValue(args),
        },
      }),
    })
    const envelope = await response.json() as { ok?: boolean; value?: unknown; error?: { message?: string } }
    if (!response.ok || envelope.ok !== true) throw new Error(envelope.error?.message ?? `Arkme Host returned HTTP ${String(response.status)}`)
    return envelope.value
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
      const styles = new Styles()
      const traps = {
        setTimeout: unavailable('setTimeout'), setInterval: unavailable('setInterval'),
        clearTimeout: unavailable('clearTimeout'), clearInterval: unavailable('clearInterval'),
        fetch: unavailable('fetch'), require: unavailable('require'),
      }
      const parameters = ['React', 'console', 'styles', 'host', 'harness', ...Object.keys(traps), 'process', 'Buffer']
      const closure = new Function(...parameters, `return (async () => {\n${spec.code}\n})()`)
      const taggedConsole = {
        ...console,
        log: (...args: unknown[]) => console.log(`[arkme-extension:${spec.extensionId}]`, ...args),
        info: (...args: unknown[]) => console.info(`[arkme-extension:${spec.extensionId}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[arkme-extension:${spec.extensionId}]`, ...args),
        error: (...args: unknown[]) => console.error(`[arkme-extension:${spec.extensionId}]`, ...args),
      }
      const harness = new Proxy({}, { get(_target, property) { throw new Error(`harness.${String(property)} belongs to the Host half`) } })
      const evaluated = await closure(
        React, taggedConsole, styles, { call: callHost }, harness, ...Object.values(traps), undefined, undefined,
      )
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
      ctx.effect(() => () => styles.dispose(), `arkme-extension:${spec.extensionId}:styles`)
      await ctx.plugin(guarded)
    },
  }
}

export function renderPersistentClientBundle(packageName: string, spec: PersistentClientSpec): string {
  return [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {`,
    `  return (${persistentClientFactory.toString()})(require, ${JSON.stringify(spec)})`,
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
