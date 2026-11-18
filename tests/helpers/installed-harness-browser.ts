import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vm from 'node:vm'
import { JSDOM } from 'jsdom'

/** Load the installed browser's real React/virtualizer, without booting its app. */
export async function installedHarnessBrowser(bin: string) {
  const { SourceTextModule } = vm
  if (typeof SourceTextModule !== 'function') throw new Error('Native browser acceptance requires NODE_OPTIONS=--experimental-vm-modules')
  const runtime = createRequire(realpathSync(bin))
  const index = runtime.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  const scripts = [...readFileSync(index, 'utf8').matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
  if (scripts.length !== 1) throw new Error('Unsupported native browser entry')
  const entry = realpathSync(resolve(dirname(index), scripts[0]![1]!.replace(/^\//, '')))
  const assets = dirname(entry)
  const source = readFileSync(entry, 'utf8')
  const boot = [...source.matchAll(/\bconst [\w$]+=globalThis\.dshDesktopBoot\b/g)]
  const maps = [...source.matchAll(/function ([\w$]+)\(\)\{return\{react:[\s\S]{0,2000}?"@tanstack\/react-virtual"/g)]
  if (boot.length !== 1 || maps.length !== 1 || maps[0]!.index! >= boot[0]!.index!) throw new Error('Unsupported native browser builtin boundary')
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1/', runScripts: 'outside-only', pretendToBeVisual: true,
  })
  try {
    Object.assign(dom.window, {
      TextEncoder, TextDecoder,
      fetch: () => { throw new Error('Native presentation test must not access the network') },
      XMLHttpRequest: class { constructor() { throw new Error('Native presentation test must not access the network') } },
      WebSocket: class { constructor() { throw new Error('Native presentation test must not access the network') } },
      Worker: class { constructor() { throw new Error('Native presentation test must not start workers') } },
    })
    const modules = new Map<string, vm.SourceTextModule>()
    const moduleFor = (file: string, code?: string): vm.SourceTextModule => {
      const path = realpathSync(file)
      if (!path.startsWith(assets + sep)) throw new Error('Native module escaped browser assets')
      const cached = modules.get(path)
      if (cached) return cached
      const module = new SourceTextModule(code ?? readFileSync(path, 'utf8'), {
        context: dom.getInternalVMContext(), identifier: path,
        initializeImportMeta(meta) { meta.url = pathToFileURL(path).href },
        importModuleDynamically() { throw new Error('Native presentation test must not bootstrap dynamic modules') },
      })
      modules.set(path, module)
      return module
    }
    const main = moduleFor(entry, source.slice(0, boot[0]!.index!) + `;globalThis.__nativeTestBuiltins=${maps[0]![1]}();`)
    await main.link((specifier, parent) => {
      if (!specifier.startsWith('.')) throw new Error('Unexpected native browser import')
      return moduleFor(resolve(dirname(parent.identifier), specifier))
    })
    await main.evaluate()
    const builtins = (dom.window as any).__nativeTestBuiltins as Record<string, any>
    if (typeof builtins?.['@tanstack/react-virtual']?.useVirtualizer !== 'function') throw new Error('Native browser virtualizer unavailable')
    return { dom, builtins }
  } catch (error) { dom.window.close(); throw error }
}

/** JSDOM supplies DOM events; this supplies the browser's measured viewport. */
export function installMeasuredViewport(window: JSDOM['window']) {
  const height = (element: Element) => element.tagName === 'BUTTON' ? 24 : 512
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { configurable: true, get() { return 48 } },
    offsetHeight: { configurable: true, get() { return height(this) } },
    clientWidth: { configurable: true, get() { return 48 } },
    clientHeight: { configurable: true, get() { return height(this) } },
    getBoundingClientRect: { configurable: true, value(this: Element) { return new window.DOMRect(0, 0, 48, height(this)) } },
  })
  window.ResizeObserver = class {
    private targets = new Set<Element>()
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target)
      window.queueMicrotask(() => {
        if (!this.targets.has(target)) return
        const rect = target.getBoundingClientRect()
        const size = [{ inlineSize: rect.width, blockSize: rect.height }]
        this.callback([{ target, contentRect: rect, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size }], this)
      })
    }
    unobserve(target: Element) { this.targets.delete(target) }
    disconnect() { this.targets.clear() }
  }
}
