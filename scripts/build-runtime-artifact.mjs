import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
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

function writeTarString(header, offset, length, value) {
  const encoded = Buffer.from(value)
  if (encoded.length > length) throw new Error(`ustar field is too long: ${value}`)
  encoded.copy(header, offset)
}

function writeTarOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0')
  if (encoded.length >= length) throw new Error(`ustar numeric field is too large: ${value}`)
  writeTarString(header, offset, length, `${encoded}\0`)
}

function splitUstarPath(rawName) {
  const directory = rawName.endsWith('/')
  const name = directory ? rawName.slice(0, -1) : rawName
  if (Buffer.byteLength(name) <= 100) return { name: directory ? `${name}/` : name, prefix: '' }
  const segments = name.split('/')
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const prefix = segments.slice(0, index).join('/')
    const basename = segments.slice(index).join('/') + (directory ? '/' : '')
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(basename) <= 100) {
      return { name: basename, prefix }
    }
  }
  throw new Error(`runtime artifact path does not fit ustar: ${rawName}`)
}

function createTarHeader(entry) {
  const header = Buffer.alloc(512)
  const pathFields = splitUstarPath(entry.name)
  writeTarString(header, 0, 100, pathFields.name)
  writeTarOctal(header, 100, 8, entry.mode)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, entry.directory ? 0 : entry.size)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = entry.directory ? 0x35 : 0x30
  writeTarString(header, 257, 6, 'ustar\0')
  writeTarString(header, 263, 2, '00')
  writeTarString(header, 265, 32, 'root')
  writeTarString(header, 297, 32, 'root')
  writeTarString(header, 345, 155, pathFields.prefix)
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')
  writeTarString(header, 148, 8, `${checksum}\0 `)
  return header
}

async function deterministicTarEntries(packageDirectory) {
  const result = []
  async function visit(directory, prefix = '') {
    const names = (await readdir(directory)).sort()
    for (const name of names) {
      const relativePath = prefix === '' ? name : `${prefix}/${name}`
      validateArchivePath(relativePath)
      const absolutePath = join(directory, name)
      const info = await lstat(absolutePath)
      if (info.isSymbolicLink()) throw new Error(`runtime artifact must not contain a symbolic link: ${relativePath}`)
      if (info.isDirectory()) {
        result.push({ absolutePath, directory: true, mode: 0o755, name: `${relativePath}/`, size: 0 })
        await visit(absolutePath, relativePath)
      } else if (info.isFile()) {
        result.push({
          absolutePath,
          directory: false,
          mode: (info.mode & 0o111) === 0 ? 0o644 : 0o755,
          name: relativePath,
          size: info.size,
        })
      } else {
        throw new Error(`runtime artifact entry must be a regular file or directory: ${relativePath}`)
      }
    }
  }
  await visit(packageDirectory)
  return result
}

async function writeDeterministicTar(packageDirectory, outputPath) {
  const output = await open(outputPath, 'w', 0o600)
  try {
    for (const entry of await deterministicTarEntries(packageDirectory)) {
      await output.write(createTarHeader(entry))
      if (!entry.directory) {
        const data = await readFile(entry.absolutePath)
        await output.write(data)
        const padding = (512 - (data.length % 512)) % 512
        if (padding > 0) await output.write(Buffer.alloc(padding))
      }
    }
    await output.write(Buffer.alloc(1024))
  } finally {
    await output.close()
  }
}

export async function createRuntimeArchive({ packageDirectory, outputDirectory }) {
  const canonicalPackageDirectory = resolve(packageDirectory)
  const canonicalOutputDirectory = resolve(outputDirectory)
  const manifest = validatePackageManifest(JSON.parse(await readFile(join(canonicalPackageDirectory, 'package.json'), 'utf8')))
  const inspection = await inspectPackageDirectory(canonicalPackageDirectory)
  await mkdir(canonicalOutputDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(join(canonicalOutputDirectory, '.arkme-runtime-archive-'))
  const rawTarPath = join(temporaryDirectory, 'artifact.tar')
  const temporaryArtifactPath = join(temporaryDirectory, `dsh-arkme-${manifest.version}.tar.zst`)
  const artifactName = basename(temporaryArtifactPath)
  const artifactPath = join(canonicalOutputDirectory, artifactName)

  try {
    await writeDeterministicTar(canonicalPackageDirectory, rawTarPath)
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
