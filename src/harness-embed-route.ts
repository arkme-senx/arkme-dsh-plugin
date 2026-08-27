import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const ARKME_PLUGIN_PACKAGE_NAME = '@senguoyun/dsh-arkme'
export const DSH_CLIENT_HMR_PACKAGE_NAME = '@deepseek-ai/dsh-client-hmr'

const REQUIRED_BOOT_PACKAGES = [
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
] as const

export interface DshWebBootEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  immediately?: boolean
  external?: string[]
}

export interface DshWebBootGraph {
  rev: string
  entries: DshWebBootEntry[]
}

interface HarnessEmbedRouteOptions {
  getGraph(): DshWebBootGraph
  installedPackageNames(): readonly string[]
  readRootHtml(): Promise<string>
  onError?(error: unknown): void
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

function bootAssignment(graph: DshWebBootGraph): string {
  return `window.__DSH_BOOT__ = ${JSON.stringify(graph).replaceAll('<', '\\u003c')}`
}

function referencesPackage(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`)
}

function assertNoRemovedDependencies(entries: readonly DshWebBootEntry[], removedPackageNames: ReadonlySet<string>): void {
  for (const entry of entries) {
    for (const dependency of [...(entry.inject ?? []), ...(entry.external ?? [])]) {
      const removed = [...removedPackageNames].find(packageName => referencesPackage(dependency, packageName))
      if (removed !== undefined) {
        throw new Error(`harness boot graph: kept package ${entry.id} depends on removed package ${removed}`)
      }
    }
  }
}

/**
 * Build the iframe-only DSH graph without any Arkme-managed extension clients.
 * Host halves stay process-owned and untouched; only this document's browser
 * boot graph is projected.
 */
export function projectHarnessBootGraph(
  graph: DshWebBootGraph,
  installedPackageNames: readonly string[],
): DshWebBootGraph {
  const removedPackageNames = new Set([
    ARKME_PLUGIN_PACKAGE_NAME,
    DSH_CLIENT_HMR_PACKAGE_NAME,
    ...installedPackageNames.map(name => name.trim()).filter(Boolean),
  ])
  const entries = graph.entries.filter(entry => !removedPackageNames.has(entry.id))

  for (const required of REQUIRED_BOOT_PACKAGES) {
    if (!entries.some(entry => entry.id === required)) {
      throw new Error(`harness boot graph: required package ${required} is missing`)
    }
  }
  assertNoRemovedDependencies(entries, removedPackageNames)

  return {
    rev: shortHash(JSON.stringify(entries)),
    entries,
  }
}

/** Replace exactly the graph DSH injected into the current root document. */
export function replaceHarnessBootGraph(
  html: string,
  fullGraph: DshWebBootGraph,
  projectedGraph: DshWebBootGraph,
): string {
  const fullAssignment = bootAssignment(fullGraph)
  const first = html.indexOf(fullAssignment)
  if (first === -1 || html.indexOf(fullAssignment, first + fullAssignment.length) !== -1) {
    throw new Error('harness boot graph: expected exactly one current DSH boot assignment')
  }
  return `${html.slice(0, first)}${bootAssignment(projectedGraph)}${html.slice(first + fullAssignment.length)}`
}

export function createHarnessEmbedRouteHandler(options: HarnessEmbedRouteOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end()
      return
    }

    try {
      const fullGraph = options.getGraph()
      const projectedGraph = projectHarnessBootGraph(fullGraph, options.installedPackageNames())
      const html = replaceHarnessBootGraph(await options.readRootHtml(), fullGraph, projectedGraph)
      const body = Buffer.from(html)
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.byteLength,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(method === 'HEAD' ? undefined : body)
    } catch (error) {
      options.onError?.(error)
      const body = Buffer.from('<!doctype html><html><body>DeepSeek Harness unavailable</body></html>')
      response.writeHead(503, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.byteLength,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(method === 'HEAD' ? undefined : body)
    }
  }
}
