import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import ts from 'typescript'
import { Worker } from 'node:worker_threads'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const clientPath = join(process.cwd(), 'lib', 'client.js')
const client = ts.createSourceFile(clientPath, readFileSync(clientPath, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
const unsupportedClientModules = new Set()

function inspectClientRequires(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
    const argument = node.arguments[0]
    if (argument && ts.isStringLiteral(argument)) {
      const name = argument.text
      if (name.startsWith('node:') || nodeBuiltins.has(name)) unsupportedClientModules.add(name)
    }
  }
  ts.forEachChild(node, inspectClientRequires)
}

inspectClientRequires(client)
if (unsupportedClientModules.size > 0) {
  throw new Error(`built browser plugin requires Node modules unavailable in Harness: ${[...unsupportedClientModules].join(', ')}`)
}

const helperPath = join(process.cwd(), 'lib', 'plugin-updater-helper.js')
const result = spawnSync(process.execPath, [helperPath], {
  encoding: 'utf8',
  timeout: 10_000,
})
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

if (result.status === 0 || !output.includes('updater plan path is required')) {
  throw new Error('built plugin updater helper is not an executable entrypoint')
}

// Exercise the actual bundled worker and its relative imports in a path with spaces.
const directory = await mkdtemp(join(tmpdir(), 'arkme timeline worker '))
const worker = new Worker(pathToFileURL(join(process.cwd(), 'lib', 'timeline-cache-worker.js')), { workerData: { directory } })
try {
  let id = 0
  const call = command => new Promise((resolve, reject) => {
    const request = ++id
    const timer = setTimeout(() => finish(new Error('timeline worker timed out')), 10000)
    const onError = error => finish(error)
    const onMessage = reply => { if (reply.id === request) finish(reply.failed ? new Error('timeline worker rejected command') : undefined, reply.value) }
    const finish = (error, value) => {
      clearTimeout(timer); worker.off('error', onError); worker.off('message', onMessage)
      if (error) reject(error); else resolve(value)
    }
    worker.on('error', onError); worker.on('message', onMessage); worker.postMessage({ id: request, command })
  })
  const ticket = await call({ kind: 'reserve' })
  if (!Number.isSafeInteger(ticket) || ticket <= 0) throw new Error('invalid worker ticket')
  const page = { source: { sourceRef: 'fixture', kind: 'private_chat', displayName: 'Fixture' }, items: [], hasMore: false,
    unified: { protocolVersion: 1, events: [], sources: [], complete: true, windowTokens: [], olderHasMore: false, newerHasMore: false, hasMore: false } }
  if (!await call({ kind: 'write', scope: 'fixture', request: 'initial', page, options: { ticket, latest: true } })) throw new Error('worker did not commit')
  const restored = await call({ kind: 'read', scope: 'fixture', request: 'initial' })
  if (restored?.cache?.persistence !== 'committed') throw new Error('worker did not restore its commit')
  await call({ kind: 'close' })
  console.log('Verified bundled timeline storage worker (commit/read/close)')
} finally { await worker.terminate(); await rm(directory, { recursive: true, force: true }) }
