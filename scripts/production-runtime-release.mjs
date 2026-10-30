import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectEvidence, fallbackNotes, generateNotes, git, summarizeNotes, validateNotes } from './runtime-release-notes.mjs'

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const shaPattern = /^[0-9a-f]{40}$/
const versionsPath = '/api/public/v1/ci/arkme-plugin/runtime/versions'

// Matches uuid.NewSHA1(uuid.NameSpaceURL, "arkme-runtime:arkme-plugin:" + version) in Backend.
export function runtimeVersionID(version) {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
  const bytes = createHash('sha1').update(namespace).update(`arkme-runtime:arkme-plugin:${version}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function identity(version, sourceSHA) {
  if (!stableVersion.test(version ?? '') || !shaPattern.test(sourceSHA ?? '')) throw new Error('Invalid production release identity')
}

export async function requestJSON(url, { token, method = 'GET', body, allow404 = false, fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!token || /\s/.test(token)) throw new Error('Missing or invalid service token')
  for (let attempt = 0; attempt < 3; attempt++) {
    let response
    try {
      response = await fetchImpl(url, {
        method, signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { if (attempt === 2) throw new Error('Release service transport failed') }
    if (response?.status === 404 && allow404) return undefined
    if (response?.ok) return response.json()
    if (response && response.status !== 429 && response.status < 500) throw new Error(`Release service HTTP ${response.status}`)
    if (attempt < 2) await sleep(1000 * (attempt + 1))
  }
  throw new Error('Release service unavailable after retries')
}

export function services(env, fetchImpl = globalThis.fetch) {
  const origin = new URL(env.ARKME_BACKEND_BASE_URL)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid Backend origin')
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) throw new Error('Invalid repository')
  return {
    backend: (id) => requestJSON(`${origin.origin}${versionsPath}/${encodeURIComponent(id)}`, { token: env.ARKME_CI_TRIGGER_SECRET, allow404: true, fetchImpl }),
    github: (path, options = {}) => requestJSON(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, { token: env.GH_TOKEN, fetchImpl, ...options }),
  }
}

export function matchesRuntime(runtime, version, sourceSHA) {
  return runtime?.component === 'arkme-plugin' && runtime.version === version && runtime.source_revision === sourceSHA
}

export function wasActivated(runtime) {
  return runtime?.status === 'ready' && Number.isSafeInteger(runtime.last_activated_version_code) && runtime.last_activated_version_code > 0
}

export async function findBaseline({ cwd, version, sourceSHA, backend, legacyIDs = {} }) {
  const tags = (await git(cwd, 'tag', '--merged', sourceSHA, '--sort=-version:refname')).split('\n')
    .filter(tag => tag.startsWith('v') && stableVersion.test(tag.slice(1)) && tag !== `v${version}`)
  for (const [index, tag] of tags.entries()) {
    if (index >= 100) throw new Error('No verified baseline in the last 100 formal tags; configure historical Runtime IDs')
    const sha = await git(cwd, 'rev-parse', `${tag}^{commit}`)
    const runtime = await backend(legacyIDs[tag] || runtimeVersionID(tag.slice(1)))
    if (matchesRuntime(runtime, tag.slice(1), sha) && wasActivated(runtime)) return { tag, sha, runtimeId: runtime.id }
  }
  return null
}

export async function collectPullRequests({ cwd, baseSHA, sourceSHA, github }) {
  if (!baseSHA) return []
  // Restrict PR reads to merged commits in the actual range, not repository-wide recent PRs.
  const hashes = (await git(cwd, 'log', '--format=%H', `${baseSHA}..${sourceSHA}`)).split('\n').filter(Boolean)
  if (hashes.length > 200) throw new Error('PR evidence exceeds commit limit')
  const found = new Map()
  for (const sha of hashes) {
    const prs = await github(`commits/${sha}/pulls?per_page=100`)
    if (prs.length === 100) throw new Error('PR evidence exceeds page limit')
    for (const pr of prs) {
      if (pr.merged_at && pr.base?.ref === 'master') found.set(pr.number, { number: pr.number, title: pr.title, body: pr.body })
    }
  }
  return [...found.values()]
}

async function readRecord(directory) {
  try { return JSON.parse(await readFile(join(directory, 'record.json'), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

export async function saveRecord(directory, record) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'record.json.tmp'), JSON.stringify(record, null, 2) + '\n')
  await rename(join(directory, 'record.json.tmp'), join(directory, 'record.json'))
  await writeFile(join(directory, 'notes.txt'), record.notes, 'utf8')
}

export async function prepareRelease({ cwd, directory, version, sourceSHA, backend, github, legacyIDs = {}, modelOptions = {}, warn = () => {} }) {
  identity(version, sourceSHA)
  if (await git(cwd, 'rev-parse', 'HEAD') !== sourceSHA) throw new Error('Source checkout does not match release SHA')
  const tags = (await git(cwd, 'tag', '--list', `v${version}`)).split('\n')
  if (tags.includes(`v${version}`) && await git(cwd, 'rev-parse', `v${version}^{commit}`) !== sourceSHA) {
    throw new Error('Existing release Tag points to another commit')
  }
  const existing = await backend(runtimeVersionID(version))
  if (existing && !matchesRuntime(existing, version, sourceSHA)) throw new Error('Existing Runtime has a different release identity')
  let record = await readRecord(directory)
  if (record && (record.version !== version || record.sourceSHA !== sourceSHA || record.schemaVersion !== 1)) throw new Error('Cached release identity mismatch')
  if (existing) {
    // Backend is the durable source of truth after version creation, including unknown publish outcomes.
    validateNotes(existing.notes)
    record = { schemaVersion: 1, version, sourceSHA, base: record?.base ?? null, notes: existing.notes, reason: 'backend-recovery', items: record?.items ?? [] }
    if (wasActivated(existing)) record.activation = { versionId: existing.id, versionCode: existing.last_activated_version_code }
  } else if (!record) {
    const base = await findBaseline({ cwd, version, sourceSHA, backend, legacyIDs })
    let generated
    try {
      const pullRequests = await collectPullRequests({ cwd, baseSHA: base?.sha, sourceSHA, github })
      const evidence = await collectEvidence({ cwd, baseSHA: base?.sha, sourceSHA, pullRequests })
      generated = await generateNotes(evidence, { ...modelOptions, warn })
    } catch {
      warn('Change evidence unavailable or exceeds limits; using fallback')
      generated = { notes: fallbackNotes, items: [], reason: 'evidence-unavailable' }
    }
    record = { schemaVersion: 1, version, sourceSHA, base, ...generated }
  }
  validateNotes(record.notes)
  record.summary = summarizeNotes(record.notes)
  await saveRecord(directory, record)
  // Ephemeral build metadata only: source version, lockfile and release SHA remain unchanged.
  const path = join(cwd, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest.version !== version || !manifest.arkme?.updateNotice) throw new Error('Invalid Runtime package metadata')
  manifest.arkme.updateNotice.summary = record.summary
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
  return record
}

export async function finalizeRelease(record, { backend, github }) {
  identity(record.version, record.sourceSHA)
  validateNotes(record.notes)
  const runtime = await backend(runtimeVersionID(record.version))
  if (!matchesRuntime(runtime, record.version, record.sourceSHA) || !wasActivated(runtime) || runtime.notes !== record.notes) {
    throw new Error('Runtime activation and stored notes must be confirmed before tagging')
  }
  const tag = `v${record.version}`
  let ref = await github(`git/ref/tags/${tag}`, { allow404: true })
  if (!ref) {
    // A timeout may mean GitHub accepted the ref. Recover by reading the ref on the next run.
    ref = await github('git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: record.sourceSHA } })
  }
  let object = ref.object
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) object = (await github(`git/tags/${object.sha}`)).object
  if (object?.type !== 'commit' || object.sha !== record.sourceSHA) throw new Error('Release Tag points to another commit; refusing to overwrite')
  const release = await github(`releases/tags/${tag}`, { allow404: true })
  // Preserve any existing public release, including human edits. A draft is not a completed release.
  if (release) {
    if (release.draft || release.prerelease) throw new Error('Existing Release is not a formal public release')
    return release
  }
  return github('releases', { method: 'POST', body: { tag_name: tag, target_commitish: record.sourceSHA, name: tag, body: record.notes, draft: false, prerelease: false } })
}

export async function publishProductionRelease(record, { backend, github, publishArtifact, artifactOptions = {} }) {
  identity(record?.version, record?.sourceSHA)
  validateNotes(record.notes)
  const existing = await backend(runtimeVersionID(record.version))
  if (existing && (!matchesRuntime(existing, record.version, record.sourceSHA) || existing.notes !== record.notes)) {
    throw new Error('Stored Runtime identity or notes differ from the saved release')
  }
  if (!existing || !wasActivated(existing)) {
    await publishArtifact({ ...artifactOptions, sourceSHA: record.sourceSHA, notes: record.notes })
  }
  return finalizeRelease(record, { backend, github })
}

async function main() {
  const env = process.env
  const cwd = resolve(env.ARKME_SOURCE_DIR || '.')
  const directory = resolve(env.ARKME_RELEASE_NOTES_DIR || '.production-release')
  const api = services(env)
  const warn = message => process.stdout.write(`::warning::${message}\n`)
  if (process.argv[2] === 'prepare') {
    const record = await prepareRelease({ cwd, directory, version: env.VERSION, sourceSHA: env.ARKME_RELEASE_SOURCE_SHA, ...api,
      legacyIDs: JSON.parse(env.ARKME_LEGACY_RUNTIME_IDS || '{}'),
      modelOptions: { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_RELEASE_NOTES_MODEL }, warn })
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `already_activated=${Boolean(record.activation)}\n`)
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `比较基线：${record.base?.tag || '首次发布（无已核验 Tag）'}\n\n生成状态：${record.reason}\n\n${record.notes}\n`)
  } else if (process.argv[2] === 'publish') {
    const record = await readRecord(directory)
    identity(record?.version, record?.sourceSHA)
    if (record.version !== env.VERSION || record.sourceSHA !== env.ARKME_RELEASE_SOURCE_SHA) throw new Error('Release record identity mismatch')
    if (await readFile(join(directory, 'notes.txt'), 'utf8') !== record.notes) throw new Error('Notes file differs from release record')
    const { publishRuntimeArtifact, readHarnessVersionCodeRangeFromEnvironment } = await import('./publish-runtime-artifact.mjs')
    await publishProductionRelease(record, { ...api,
      artifactOptions: { artifactDirectory: join(cwd, 'dist/runtime-artifacts'), backendBaseURL: env.ARKME_BACKEND_BASE_URL,
        secret: env.ARKME_CI_TRIGGER_SECRET, verifyStoredNotes: true, harnessVersionCodeRange: readHarnessVersionCodeRangeFromEnvironment(env) },
      publishArtifact: options => publishRuntimeArtifact(options, { log: message => process.stdout.write(`${message}\n`) }),
    })
  } else throw new Error('Usage: production-runtime-release.mjs prepare|publish')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
