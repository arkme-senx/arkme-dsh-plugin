// Deterministic Host/SQLite workload. Run baseline and candidate in separate
// processes, on the same machine. This is not a renderer FPS or WAN benchmark.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const baseline = option('--baseline'), output = option('--output')
const source = new Map(['cloud-native-transport.ts', 'native-history-cache.ts'].map(name => {
  const relative = `src/dsh-remote/${name}`
  return [join(root, relative), baseline ? execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' }) : undefined]
}))
const vite = await createServer({ root, configFile: false, ssr: { noExternal: ['@deepseek-ai/dsh-session'] }, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true }, plugins: [{
  name: 'isolated-cache-profile', enforce: 'pre',
  resolveId(id) { if (id === '@deepseek-ai/dsh-session/surface') return '\0profile-native-validation' },
  load(id) {
    // Native schema correctness is covered independently by official-runtime
    // acceptance. Both revisions use identical validation cost in this profile.
    if (id === '\0profile-native-validation') return 'export function validateSurfaceMetadata(){}; export function validateSessionEventData(){}'
    if (baseline && source.has(id)) return source.get(id)
  },
}] })
const { DshCloudNativeTransport } = await vite.ssrLoadModule('/src/dsh-remote/cloud-native-transport.ts')
const { DshNativeHistoryCache } = await vite.ssrLoadModule('/src/dsh-remote/native-history-cache.ts')
const directory = mkdtempSync(join(tmpdir(), 'dsh large cache profile '))
const percentile = (samples, p) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1]
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const hashRecords = entries => createHash('sha256').update(JSON.stringify(canonical(entries))).digest('hex')
const makeRecords = count => Array.from({ length: count }, (_, seq) => ({ type: 'event', event: {
  seq, time: seq + 1, type: seq % 100 === 0 ? 'turn/start' : seq % 100 === 99 ? 'turn/end' : 'session/config', data: { text: `${seq}:${'x'.repeat(512)}` },
} }))
let records = makeRecords(50_000)
const report = { source: baseline ?? 'working-tree', platform: process.platform, arch: process.arch, node: process.version,
  workload: { events: records.length, turns: 500, payloadTextBytes: 512, concurrentConsumers: [1, 4, 8], samplesPerScenario: 20, simulatedRequestLatencyMs: 2, validators: 'identical no-op; official runtime checked separately', sqliteMutationCounters: 'SQL triggers enabled in both revisions' }, scenarios: [] }
try {
  for (const windows of [1, 4, 8]) {
    records = makeRecords(50_000)
    const scope = join(directory, String(windows)), store = new DshNativeHistoryCache(scope)
    const db = new DatabaseSync(join(scope, 'native-history.sqlite3'))
    db.exec(`CREATE TABLE mutations(kind TEXT PRIMARY KEY,count INTEGER); INSERT INTO mutations VALUES ('insert',0),('update',0),('delete',0);
      CREATE TRIGGER count_insert AFTER INSERT ON events BEGIN UPDATE mutations SET count=count+1 WHERE kind='insert'; END;
      CREATE TRIGGER count_update AFTER UPDATE ON events BEGIN UPDATE mutations SET count=count+1 WHERE kind='update'; END;
      CREATE TRIGGER count_delete AFTER DELETE ON events BEGIN UPDATE mutations SET count=count+1 WHERE kind='delete'; END;`)
    let counts, title = 'original', updated = 1, generation = 'generation-1'
    const reset = () => { counts = { metadata: 0, historyRequests: 0, historyBytes: 0, cacheWrites: 0 }; db.exec('UPDATE mutations SET count=0') }
    reset()
    const post = async (path, body) => {
      await delay(2)
      if (path.endsWith('/sessions/metadata')) { counts.metadata++; return { runtime_ref: 'runtime', session_ref: 'session', history_revision: generation, created_at: 1, title, source_updated_at: updated, projection_as_of_seq: records.length - 1, last_event_seq: records.length - 1 } }
      if (path.endsWith('/session-events/list')) {
        const end = Math.min(Number(body.before_seq ?? records.length), records.length), start = Math.max(0, end - 100)
        const value = { entries: records.slice(start, end).map(({ event }) => ({ event })), ...(start ? { next_cursor: start } : {}) }
        counts.historyRequests++; counts.historyBytes += Buffer.byteLength(JSON.stringify(value)); return value
      }
      throw Error(path)
    }
    const cloud = new DshCloudNativeTransport({ post }, async () => {})
    const body = { mode: 'pull', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'session' } } } } }
    const key = DshNativeHistoryCache.key('isolated-profile', 'runtime', { kind: 'session', sessionId: 'session' })
    const cache = { key: () => key, store: { snapshot: key => store.snapshot(key), page: (key, through, before) => store.page(key, through, before), write: (...args) => { counts.cacheWrites++; store.write(...args) } } }
    const call = (request, id) => cloud.call('runtime', request, id, new AbortController().signal, cache)
    const digest = () => hashRecords(db.prepare('SELECT seq,payload FROM events ORDER BY seq').all().map(row => JSON.parse(String(row.payload))))
    const stats = () => ({ ...counts, eventMutations: Object.fromEntries(db.prepare('SELECT kind,count FROM mutations').all().map(r => [r.kind, Number(r.count)])), cachedEvents: Number(db.prepare('SELECT count(*) AS n FROM events').get().n) })
    const measure = async (name, action, rounds = 20) => {
      reset(); global.gc?.(); const heapBefore = process.memoryUsage().heapUsed, samples = [], stalls = []
      for (let round = 0; round < rounds; round++) {
        const tick = performance.now(), timer = delay(0).then(() => stalls.push(performance.now() - tick))
        await Promise.all(Array.from({ length: windows }, async (_, index) => {
          const started = performance.now(); await action(round, index); samples.push(performance.now() - started)
        })); await timer
      }
      global.gc?.(); const result = { windows, name, samples: samples.length, ...stats(), latencyMs: { p50: percentile(samples, .5), p95: percentile(samples, .95) }, timerDelayMaxMs: Math.max(...stalls), heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore }
      report.scenarios.push(result); return result
    }
    try {
      await measure('cold-open', async (_, i) => { await call(body, `cold-${i}`); cloud.release(`cold-${i}`) }, 1)
      store.write(key, records); const originalDigest = digest()
      await measure('warm-open', async (round, i) => { const id = `warm-${round}-${i}`; await call(body, id); cloud.release(id) })
      await Promise.all(Array.from({ length: windows }, (_, i) => call(body, `watch-${i}`)))
      await measure('unchanged-poll', (_, i) => call({ mode: 'pull' }, `watch-${i}`))
      await measure('title-only-poll', (round, i) => { title = `title-${round}`; return call({ mode: 'pull' }, `watch-${i}`) })
      const retainedAfterRename = digest() === originalDigest
      await measure('timestamp-only-poll', (round, i) => { updated = round + 2; return call({ mode: 'pull' }, `watch-${i}`) })
      records = makeRecords(50_100)
      await measure('append-one-turn', (_, i) => call({ mode: 'pull' }, `watch-${i}`), 1)
      const retainedAfterAppend = digest() === hashRecords(records)
      // Compare generation replacement with identical cache sizes, even though
      // the baseline already evicted old pages during metadata-only updates.
      store.write(key, records)
      // Setup can exceed the real 45-second idle lease on a busy developer
      // machine. Renew consumers after setup, outside the measured workload.
      for (let i = 0; i < windows; i++) cloud.release(`watch-${i}`)
      await Promise.all(Array.from({ length: windows }, (_, i) => call(body, `watch-${i}`)))
      generation = 'migrated-generation'
      await measure('migration-generation', (_, i) => call({ mode: 'pull' }, `watch-${i}`), 1)
      const migrationMatches = digest() === hashRecords(records.slice(-500))
      cloud.close()
      const remainingStreams = Array.from({ length: windows }, (_, i) => cloud.has(`watch-${i}`)).filter(Boolean).length
      report.scenarios.push({ windows, name: 'integrity-and-cleanup', retainedAfterRename, retainedAfterAppend, migrationMatches, remainingStreams })
      if (!baseline && (!retainedAfterRename || !retainedAfterAppend || !migrationMatches || remainingStreams)) throw Error('Candidate cache integrity failed')
    } finally { cloud.close(); db.close(); store.close() }
  }
  if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await vite.close(); rmSync(directory, { recursive: true, force: true }) }
