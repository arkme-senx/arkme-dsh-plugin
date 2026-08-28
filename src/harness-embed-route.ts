import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const ARKME_PLUGIN_PACKAGE_NAME = '@senguoyun/dsh-arkme'
export const DSH_CLIENT_HMR_PACKAGE_NAME = '@deepseek-ai/dsh-client-hmr'

const REQUIRED_BOOT_PACKAGE_GROUPS = [
  {
    capability: 'client module loader',
    alternatives: ['@deepseek-ai/dsh-client-modules'],
  },
  {
    capability: 'client connection runtime',
    alternatives: [
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-connection',
    ],
  },
] as const

export interface DshWebBootEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  immediately?: boolean
  external?: string[]
}

export interface DshWebBootBatch {
  phase: 'bootstrap' | 'application'
  url: string
  rev: string
  entries: string[]
}

export interface DshWebBootGraph {
  rev: string
  entries: DshWebBootEntry[]
  /** Present in the structured DSH boot protocol; legacy graphs omit it. */
  batches?: DshWebBootBatch[]
}

interface HarnessEmbedRouteOptions {
  getGraph(): DshWebBootGraph
  installedPackageNames(): readonly string[]
  readRootHtml(request: IncomingMessage): Promise<string>
  onError?(error: unknown): void
}

/** Forward only the same-origin browser session needed by authenticated DSH roots. */
export function dshRootDocumentHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'text/html' }
  if (request.headers.cookie !== undefined) headers.Cookie = request.headers.cookie
  return headers
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

type BootAssignmentRenderer = (graph: DshWebBootGraph) => string

function serializedBootGraph(graph: DshWebBootGraph): string {
  return JSON.stringify(graph).replaceAll('<', '\\u003c')
}

const BOOT_ASSIGNMENT_RENDERERS: readonly BootAssignmentRenderer[] = [
  // dsh-v0.1.0-rc.8 and earlier tapIndex rendering.
  graph => `window.__DSH_BOOT__ = ${serializedBootGraph(graph)}`,
  // dsh-v0.1.1-rc.2 structured index-injection rendering.
  graph => `globalThis["__DSH_BOOT__"] = ${serializedBootGraph(graph)}`,
]

function referencesPackage(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`)
}

function dependencyRemovedBy(
  entry: DshWebBootEntry,
  removedPackageNames: ReadonlySet<string>,
): string | undefined {
  for (const dependency of [...(entry.inject ?? []), ...(entry.external ?? [])]) {
    const removed = [...removedPackageNames].find(packageName => referencesPackage(dependency, packageName))
    if (removed !== undefined) return removed
  }
  return undefined
}

function requiredBootPackages(entries: readonly DshWebBootEntry[]): ReadonlySet<string> {
  const packageNames = new Set(entries.map(entry => entry.id))
  const required = new Set<string>()
  for (const group of REQUIRED_BOOT_PACKAGE_GROUPS) {
    const available = group.alternatives.filter(packageName => packageNames.has(packageName))
    if (available.length === 0) {
      throw new Error(
        `harness boot graph: required ${group.capability} is missing; expected one of ${group.alternatives.join(', ')}`,
      )
    }
    for (const packageName of available) required.add(packageName)
  }
  return required
}

function completeRemovedPackageClosure(
  entries: readonly DshWebBootEntry[],
  removedPackageNames: Set<string>,
  requiredPackageNames: ReadonlySet<string>,
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const entry of entries) {
      if (removedPackageNames.has(entry.id)) continue
      const removed = dependencyRemovedBy(entry, removedPackageNames)
      if (removed === undefined) continue
      if (requiredPackageNames.has(entry.id)) {
        throw new Error(`harness boot graph: required package ${entry.id} depends on removed package ${removed}`)
      }
      removedPackageNames.add(entry.id)
      changed = true
    }
  }
}

function assertNoRemovedDependencies(entries: readonly DshWebBootEntry[], removedPackageNames: ReadonlySet<string>): void {
  for (const entry of entries) {
    const removed = dependencyRemovedBy(entry, removedPackageNames)
    if (removed !== undefined) {
      throw new Error(`harness boot graph: kept package ${entry.id} depends on removed package ${removed}`)
    }
  }
}

function projectBootBatches(
  batches: readonly DshWebBootBatch[] | undefined,
  keptPackageNames: ReadonlySet<string>,
): DshWebBootBatch[] | undefined {
  if (batches === undefined) return undefined
  const projected = batches.flatMap(batch => {
    const entries = batch.entries.filter(packageName => keptPackageNames.has(packageName))
    return entries.length === 0 ? [] : [{ ...batch, entries }]
  })
  const covered = new Set<string>()
  for (const batch of projected) {
    for (const packageName of batch.entries) {
      if (covered.has(packageName)) {
        throw new Error(`harness boot graph: package ${packageName} belongs to more than one projected batch`)
      }
      covered.add(packageName)
    }
  }
  for (const packageName of keptPackageNames) {
    if (!covered.has(packageName)) {
      throw new Error(`harness boot graph: package ${packageName} belongs to no projected batch`)
    }
  }
  return projected
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
  const requiredPackageNames = requiredBootPackages(graph.entries)
  const removedPackageNames = new Set([
    ARKME_PLUGIN_PACKAGE_NAME,
    DSH_CLIENT_HMR_PACKAGE_NAME,
    ...installedPackageNames.map(name => name.trim()).filter(Boolean),
  ])
  completeRemovedPackageClosure(graph.entries, removedPackageNames, requiredPackageNames)
  const entries = graph.entries.filter(entry => !removedPackageNames.has(entry.id))

  for (const required of requiredPackageNames) {
    if (!entries.some(entry => entry.id === required)) {
      throw new Error(`harness boot graph: required package ${required} was removed`)
    }
  }
  assertNoRemovedDependencies(entries, removedPackageNames)
  const batches = projectBootBatches(graph.batches, new Set(entries.map(entry => entry.id)))

  return {
    rev: shortHash(JSON.stringify(batches === undefined ? entries : { entries, batches })),
    entries,
    ...(batches === undefined ? {} : { batches }),
  }
}

/** Replace exactly the graph DSH injected into the current root document. */
export function replaceHarnessBootGraph(
  html: string,
  fullGraph: DshWebBootGraph,
  projectedGraph: DshWebBootGraph,
): string {
  const matches: Array<{
    at: number
    assignment: string
    render: BootAssignmentRenderer
  }> = []

  for (const render of BOOT_ASSIGNMENT_RENDERERS) {
    const assignment = render(fullGraph)
    let at = html.indexOf(assignment)
    while (at !== -1) {
      matches.push({ at, assignment, render })
      at = html.indexOf(assignment, at + assignment.length)
    }
  }

  if (matches.length !== 1) {
    throw new Error('harness boot graph: expected exactly one current DSH boot assignment')
  }
  const { at, assignment, render } = matches[0]!
  return `${html.slice(0, at)}${render(projectedGraph)}${html.slice(at + assignment.length)}`
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
      const html = replaceHarnessBootGraph(await options.readRootHtml(request), fullGraph, projectedGraph)
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
