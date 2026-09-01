import OSS from 'ali-oss'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'

const uploadCredentialsPath = '/api/public/v1/ci/arkme-plugin/runtime/upload-credentials'
const versionsPath = '/api/public/v1/ci/arkme-plugin/runtime/versions'
const defaultPollIntervalMs = 5_000
const defaultPollTimeoutMs = 15 * 60_000
const maxBackendAttempts = 3
const sha40Pattern = /^[0-9a-f]{40}$/
const sha256Pattern = /^[0-9a-f]{64}$/
const objectPrefixPattern = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/

function delay(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

function validateBackendOrigin(rawURL) {
  let parsed
  try {
    parsed = new URL(rawURL)
  } catch {
    throw new Error('Backend base URL must be a valid HTTPS origin')
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('Backend base URL must be a valid HTTPS origin')
  }
  return parsed.origin
}

function validateSecret(secret) {
  if (typeof secret !== 'string' || secret === '' || secret !== secret.trim() || /\s/.test(secret)) {
    throw new Error('Backend CI secret is missing or invalid')
  }
}

function safeBackendError(response, payload) {
  const code = payload && typeof payload === 'object' && typeof payload.error === 'string'
    ? ` ${payload.error}`
    : ''
  return new Error(`Backend request failed: HTTP ${response.status}${code}`)
}

export async function requestBackendJSON(url, {
  method,
  secret,
  body,
  fetchImpl = globalThis.fetch,
  sleep = delay,
}) {
  validateSecret(secret)
  for (let attempt = 1; attempt <= maxBackendAttempts; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${secret}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      if (attempt === maxBackendAttempts) {
        throw new Error(`Backend request failed after ${maxBackendAttempts} attempts`, { cause: error })
      }
      await sleep(1_000 * attempt)
      continue
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    if (response.ok) {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Backend returned an invalid JSON response')
      }
      return payload
    }

    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt === maxBackendAttempts) throw safeBackendError(response, payload)
    await sleep(1_000 * attempt)
  }
  throw new Error('Backend request failed')
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const input = createReadStream(filePath)
    input.on('data', chunk => hash.update(chunk))
    input.on('error', reject)
    input.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

async function readVerifiedArtifact(artifactDirectory) {
  const directory = resolve(artifactDirectory)
  const metadataPath = join(directory, 'artifact-metadata.json')
  let metadata
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  } catch (error) {
    throw new Error('artifact metadata is missing or invalid', { cause: error })
  }
  if (
    metadata?.schemaVersion !== 1
    || metadata.component !== 'arkme-plugin'
    || metadata.name !== '@senguoyun/dsh-arkme'
    || typeof metadata.version !== 'string'
    || semver.valid(metadata.version) !== metadata.version
    || typeof metadata.file !== 'string'
    || metadata.file !== `dsh-arkme-${metadata.version}.tar.zst`
    || !sha256Pattern.test(metadata.sha256)
    || !Number.isSafeInteger(metadata.size)
    || metadata.size <= 0
  ) {
    throw new Error('artifact metadata is invalid')
  }
  const artifactPath = join(directory, metadata.file)
  const artifactStat = await stat(artifactPath)
  if (!artifactStat.isFile()) throw new Error('runtime artifact is not a regular file')
  if (artifactStat.size !== metadata.size) throw new Error('artifact size does not match metadata')
  if (await sha256File(artifactPath) !== metadata.sha256) throw new Error('artifact SHA-256 does not match metadata')
  return { artifactPath, metadata }
}

function validatePublishOptions(options) {
  if (!options || typeof options.artifactDirectory !== 'string' || options.artifactDirectory.trim() === '') {
    throw new Error('artifact directory is required')
  }
  const backendBaseURL = validateBackendOrigin(options.backendBaseURL)
  validateSecret(options.secret)
  if (!sha40Pattern.test(options.sourceSHA)) throw new Error('source SHA must be 40 lowercase hexadecimal characters')
  if (typeof options.notes !== 'string') throw new Error('release notes must be a string')
  return backendBaseURL
}

function validateUploadGrant(grant, expectedObjectSuffix) {
  const credentials = grant?.credentials
  const objectKey = grant?.object_key
  const prefix = typeof objectKey === 'string' && objectKey.endsWith(expectedObjectSuffix)
    ? objectKey.slice(0, -expectedObjectSuffix.length)
    : ''
  if (
    typeof grant?.bucket !== 'string' || grant.bucket === ''
    || typeof grant.upload_endpoint !== 'string' || !grant.upload_endpoint.startsWith('https://')
    || typeof objectKey !== 'string' || objectKey.length > 1023
    || !objectPrefixPattern.test(prefix)
    || typeof credentials?.access_key_id !== 'string' || credentials.access_key_id === ''
    || typeof credentials.access_key_secret !== 'string' || credentials.access_key_secret === ''
    || typeof credentials.security_token !== 'string' || credentials.security_token === ''
  ) {
    throw new Error('Backend returned invalid upload credentials')
  }
  return credentials
}

function defaultOSSClient(options) {
  return new OSS(options)
}

function defaultMask(value) {
  process.stdout.write(`::add-mask::${value}\n`)
}

function ossErrorStatus(error) {
  const value = error && typeof error === 'object' ? (error.status ?? error.statusCode) : undefined
  const status = Number(value)
  return Number.isFinite(status) ? status : undefined
}

export async function uploadRuntimeObject(client, objectKey, artifactPath, headers, { sleep = delay } = {}) {
  for (let attempt = 1; attempt <= maxBackendAttempts; attempt += 1) {
    try {
      return await client.put(objectKey, artifactPath, { headers })
    } catch (error) {
      const status = ossErrorStatus(error)
      const code = error && typeof error === 'object' ? error.code : undefined
      if (status === 409 && code === 'FileAlreadyExists') return { alreadyExists: true }
      const retryable = status === undefined || status === -1 || status === -2 || status === 429 || status >= 500
      if (!retryable || attempt === maxBackendAttempts) throw error
      await sleep(1_000 * attempt)
    }
  }
  throw new Error('OSS upload failed')
}

export async function publishRuntimeArtifact(options, {
  fetchImpl = globalThis.fetch,
  createOSSClient = defaultOSSClient,
  mask = defaultMask,
  sleep = delay,
  pollIntervalMs = defaultPollIntervalMs,
  pollTimeoutMs = defaultPollTimeoutMs,
  log = () => {},
} = {}) {
  const backendBaseURL = validatePublishOptions(options)
  const { artifactPath, metadata } = await readVerifiedArtifact(options.artifactDirectory)
  const artifact = {
    version: metadata.version,
    source_sha: options.sourceSHA,
    file: metadata.file,
    sha256: metadata.sha256,
    size: metadata.size,
  }
  const request = (path, requestOptions) => requestBackendJSON(`${backendBaseURL}${path}`, {
    ...requestOptions,
    secret: options.secret,
    fetchImpl,
    sleep,
  })

  const expectedObjectSuffix = `/${metadata.version}/${metadata.sha256}/${metadata.file}`
  const grant = await request(uploadCredentialsPath, { method: 'POST', body: artifact })
  const credentials = validateUploadGrant(grant, expectedObjectSuffix)
  for (const value of [credentials.access_key_id, credentials.access_key_secret, credentials.security_token]) mask(value)
  log(`version=${metadata.version} source_sha=${options.sourceSHA} object_key=${grant.object_key}`)

  const oss = createOSSClient({
    accessKeyId: credentials.access_key_id,
    accessKeySecret: credentials.access_key_secret,
    stsToken: credentials.security_token,
    endpoint: grant.upload_endpoint,
    bucket: grant.bucket,
    secure: true,
    retryMax: 0,
  })
  await uploadRuntimeObject(oss, grant.object_key, artifactPath, {
    'Content-Type': 'application/zstd',
    'x-oss-forbid-overwrite': 'true',
    'x-oss-meta-sha256': metadata.sha256,
    'x-oss-meta-source-sha': options.sourceSHA,
  }, {
    sleep,
  })

  const created = await request(versionsPath, {
    method: 'POST',
    body: { ...artifact, notes: options.notes.trim() },
  })
  const versionID = created?.version?.id
  if (typeof versionID !== 'string' || versionID === '') throw new Error('Backend returned an invalid version ID')
  log(`version_id=${versionID} status=${created.version.status}`)

  const deadline = Date.now() + pollTimeoutMs
  let current = created.version
  while (current?.status !== 'ready') {
    if (current?.status === 'validation_failed') throw new Error(`runtime validation failed for version ${versionID}`)
    if (Date.now() >= deadline) throw new Error(`runtime validation timed out for version ${versionID}`)
    await sleep(pollIntervalMs)
    current = await request(`${versionsPath}/${encodeURIComponent(versionID)}`, { method: 'GET' })
    log(`version_id=${versionID} status=${current.status}`)
  }

  const activation = await request(`${versionsPath}/${encodeURIComponent(versionID)}/activate`, { method: 'POST' })
  if (!Number.isSafeInteger(activation?.version_code)) throw new Error('Backend returned an invalid activation result')
  return {
    version: metadata.version,
    versionId: versionID,
    versionCode: activation.version_code,
    reused: created.reused === true,
  }
}

async function main() {
  const result = await publishRuntimeArtifact({
    artifactDirectory: process.env.ARKME_RUNTIME_ARTIFACT_DIR || 'dist/runtime-artifacts',
    backendBaseURL: process.env.ARKME_BACKEND_BASE_URL,
    secret: process.env.ARKME_CI_TRIGGER_SECRET,
    sourceSHA: process.env.ARKME_RELEASE_SOURCE_SHA,
    notes: process.env.ARKME_RELEASE_NOTES || '',
  }, { log: message => process.stdout.write(`${message}\n`) })
  process.stdout.write(`Published runtime version=${result.version} source_sha=${process.env.ARKME_RELEASE_SOURCE_SHA} version_id=${result.versionId} version_code=${result.versionCode}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
