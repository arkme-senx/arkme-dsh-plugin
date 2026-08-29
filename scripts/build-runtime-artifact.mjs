import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const runtimeRequiredEntries = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
]

function validatePackageManifest(manifest) {
  if (manifest?.name !== '@senguoyun/dsh-arkme') {
    throw new Error('Arkme runtime artifact package name must be @senguoyun/dsh-arkme')
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error('Arkme runtime artifact package version is missing')
  }
  return { name: manifest.name, version: manifest.version }
}

async function runCommand(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with ${code ?? `signal ${signal}`}`))
    })
  })
}

function validateArchivePath(rawName) {
  const name = rawName.endsWith('/') ? rawName.slice(0, -1) : rawName
  if (name === '' || name.includes('\\') || name.startsWith('/')) {
    throw new Error(`unsafe archive path: ${rawName}`)
  }
  const clean = posix.normalize(name)
  if (clean !== name || clean === '.' || clean === '..' || clean.startsWith('../')) {
    throw new Error(`archive path traversal entry: ${rawName}`)
  }
  return name
}

export function validateRuntimeArchiveEntries(entries) {
  const found = new Set()
  for (const rawName of entries) found.add(validateArchivePath(rawName))
  for (const required of runtimeRequiredEntries) {
    if (!found.has(required)) throw new Error(`required archive entry is missing: ${required}`)
  }
}

function validateNpmPackageEntries(entries) {
  for (const rawName of entries) {
    const name = validateArchivePath(rawName)
    if (name !== 'package' && !name.startsWith('package/')) {
      throw new Error(`npm package entry must stay under package/: ${rawName}`)
    }
  }
}

async function inspectPackageDirectory(packageDirectory) {
  let unpackedSize = 0
  const files = new Set()

  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      validateArchivePath(relativePath)
      const absolutePath = join(directory, entry.name)
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) throw new Error(`runtime artifact must not contain a symbolic link: ${relativePath}`)
      if (info.isDirectory()) {
        await visit(absolutePath, relativePath)
      } else if (info.isFile()) {
        files.add(relativePath)
        unpackedSize += info.size
      } else {
        throw new Error(`runtime artifact entry must be a regular file or directory: ${relativePath}`)
      }
    }
  }

  await visit(packageDirectory)
  for (const required of runtimeRequiredEntries) {
    if (!files.has(required)) throw new Error(`required archive entry is missing: ${required}`)
  }
  return { unpackedSize }
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

export async function createRuntimeArchive({ packageDirectory, outputDirectory }) {
  const canonicalPackageDirectory = resolve(packageDirectory)
  const canonicalOutputDirectory = resolve(outputDirectory)
  const manifest = validatePackageManifest(JSON.parse(await readFile(join(canonicalPackageDirectory, 'package.json'), 'utf8')))
  const inspection = await inspectPackageDirectory(canonicalPackageDirectory)
  const topLevelEntries = (await readdir(canonicalPackageDirectory)).sort()
  await mkdir(canonicalOutputDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(join(canonicalOutputDirectory, '.arkme-runtime-archive-'))
  const rawTarPath = join(temporaryDirectory, 'artifact.tar')
  const temporaryArtifactPath = join(temporaryDirectory, `dsh-arkme-${manifest.version}.tar.zst`)
  const artifactName = basename(temporaryArtifactPath)
  const artifactPath = join(canonicalOutputDirectory, artifactName)

  try {
    await execFileAsync('tar', [
      '--format=ustar',
      '-cf', rawTarPath,
      '-C', canonicalPackageDirectory,
      ...topLevelEntries,
    ], {
      env: {
        ...process.env,
        COPYFILE_DISABLE: '1',
        COPY_EXTENDED_ATTRIBUTES_DISABLE: '1',
      },
    })
    const { stdout } = await execFileAsync('tar', ['-tf', rawTarPath], { encoding: 'utf8' })
    validateRuntimeArchiveEntries(stdout.trim().split('\n').filter(Boolean))
    await execFileAsync('zstd', ['-q', '-f', '-19', '--threads=0', rawTarPath, '-o', temporaryArtifactPath])
    await execFileAsync('zstd', ['-q', '-t', temporaryArtifactPath])

    const artifactStat = await stat(temporaryArtifactPath)
    const sha256 = await sha256File(temporaryArtifactPath)
    const metadata = {
      schemaVersion: 1,
      component: 'arkme-plugin',
      name: manifest.name,
      version: manifest.version,
      file: artifactName,
      sha256,
      size: artifactStat.size,
      unpackedSize: inspection.unpackedSize,
      requiredEntries: runtimeRequiredEntries,
    }

    const temporaryMetadataPath = join(temporaryDirectory, 'artifact-metadata.json')
    const temporaryChecksumsPath = join(temporaryDirectory, 'SHA256SUMS')
    await writeFile(temporaryMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    await writeFile(temporaryChecksumsPath, `${sha256}  ${artifactName}\n`)
    await rename(temporaryArtifactPath, artifactPath)
    await rename(temporaryMetadataPath, join(canonicalOutputDirectory, 'artifact-metadata.json'))
    await rename(temporaryChecksumsPath, join(canonicalOutputDirectory, 'SHA256SUMS'))
    return { artifactPath, metadata }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export function parseRuntimeArtifactArgs(args, cwd = process.cwd()) {
  let outputDirectory = resolve(cwd, 'dist/runtime-artifacts')
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument !== '--output-dir') throw new Error(`unknown argument: ${argument}`)
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error('--output-dir requires a path')
    outputDirectory = resolve(cwd, value)
    index += 1
  }
  return { outputDirectory }
}

export async function buildRuntimeArtifact({ cwd = process.cwd(), outputDirectory = resolve(cwd, 'dist/runtime-artifacts') } = {}) {
  const canonicalCwd = resolve(cwd)
  const sourceManifest = validatePackageManifest(JSON.parse(await readFile(join(canonicalCwd, 'package.json'), 'utf8')))
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'arkme-runtime-build-'))
  const packDirectory = join(temporaryDirectory, 'pack')
  const extractDirectory = join(temporaryDirectory, 'extract')
  try {
    await mkdir(packDirectory, { recursive: true })
    const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    await runCommand(pnpmCommand, [
      '--config.verifyDepsBeforeRun=warn',
      'pack',
      '--pack-destination', packDirectory,
    ], { cwd: canonicalCwd, env: process.env })
    const packageArchives = (await readdir(packDirectory))
      .filter(name => name.endsWith('.tgz'))
      .sort()
    if (packageArchives.length !== 1) {
      throw new Error(`pnpm pack must produce exactly one .tgz archive, found ${packageArchives.length}`)
    }
    const packageArchivePath = join(packDirectory, packageArchives[0])
    const { stdout } = await execFileAsync('tar', ['-tzf', packageArchivePath], { encoding: 'utf8' })
    validateNpmPackageEntries(stdout.trim().split('\n').filter(Boolean))
    await mkdir(extractDirectory, { recursive: true })
    await execFileAsync('tar', ['-xzf', packageArchivePath, '-C', extractDirectory])
    const packedDirectory = join(extractDirectory, 'package')
    const packedManifest = validatePackageManifest(JSON.parse(await readFile(join(packedDirectory, 'package.json'), 'utf8')))
    if (packedManifest.name !== sourceManifest.name || packedManifest.version !== sourceManifest.version) {
      throw new Error('packed plugin identity does not match the current package.json')
    }
    return await createRuntimeArchive({ packageDirectory: packedDirectory, outputDirectory })
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function main() {
  const { outputDirectory } = parseRuntimeArtifactArgs(process.argv.slice(2))
  const result = await buildRuntimeArtifact({ cwd: process.cwd(), outputDirectory })
  process.stdout.write(`Arkme runtime artifact: ${result.artifactPath}\n`)
  process.stdout.write(`SHA-256: ${result.metadata.sha256}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Arkme runtime artifact build failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
