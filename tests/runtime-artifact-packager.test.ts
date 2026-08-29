import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createRuntimeArchive,
  runtimeRequiredEntries,
  validateRuntimeArchiveEntries,
} from '../scripts/build-runtime-artifact.mjs'

describe('Arkme runtime artifact packager', () => {
  it('packages the plugin at the archive root and writes matching release metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-runtime-artifact-'))
    const packageDirectory = join(root, 'package')
    const outputDirectory = join(root, 'output')
    try {
      await mkdir(join(packageDirectory, 'lib'), { recursive: true })
      await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
        name: '@senguoyun/dsh-arkme',
        version: '0.1.42',
      }))
      await writeFile(join(packageDirectory, 'cordis.patch.yml'), 'version: 1\n')
      await writeFile(join(packageDirectory, 'lib/index.js'), 'export const host = true\n')
      await writeFile(join(packageDirectory, 'lib/client.js'), 'export const client = true\n')

      const result = await createRuntimeArchive({ packageDirectory, outputDirectory })

      expect(basename(result.artifactPath)).toBe('dsh-arkme-0.1.42.tar.zst')
      const artifact = await readFile(result.artifactPath)
      const sha256 = createHash('sha256').update(artifact).digest('hex')
      expect(await readFile(join(outputDirectory, 'SHA256SUMS'), 'utf8'))
        .toBe(`${sha256}  dsh-arkme-0.1.42.tar.zst\n`)
      expect(JSON.parse(await readFile(join(outputDirectory, 'artifact-metadata.json'), 'utf8'))).toEqual({
        schemaVersion: 1,
        component: 'arkme-plugin',
        name: '@senguoyun/dsh-arkme',
        version: '0.1.42',
        file: 'dsh-arkme-0.1.42.tar.zst',
        sha256,
        size: artifact.byteLength,
        unpackedSize: 113,
        requiredEntries: [
          'package.json',
          'cordis.patch.yml',
          'lib/index.js',
          'lib/client.js',
        ],
      })
      const tar = execFileSync('zstd', ['-q', '-d', '-c', result.artifactPath])
      const entries = execFileSync('tar', ['-tf', '-'], { input: tar, encoding: 'utf8' })
        .trim().split('\n')
      expect(entries).toEqual(expect.arrayContaining([
        'package.json',
        'cordis.patch.yml',
        'lib/index.js',
        'lib/client.js',
      ]))
      expect(entries.some(entry => entry.startsWith('./'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('builds the Release Set artifact from the current package.json version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-runtime-command-'))
    const projectDirectory = join(root, 'project')
    const fixtureDirectory = join(root, 'fixture')
    const packageDirectory = join(fixtureDirectory, 'package')
    const fakeBinDirectory = join(root, 'bin')
    const outputDirectory = join(root, 'output')
    try {
      await mkdir(join(packageDirectory, 'lib'), { recursive: true })
      await mkdir(fakeBinDirectory, { recursive: true })
      const manifest = JSON.stringify({ name: '@senguoyun/dsh-arkme', version: '0.1.77' })
      await mkdir(projectDirectory)
      await writeFile(join(projectDirectory, 'package.json'), manifest)
      await writeFile(join(packageDirectory, 'package.json'), manifest)
      await writeFile(join(packageDirectory, 'cordis.patch.yml'), 'version: 1\n')
      await writeFile(join(packageDirectory, 'lib/index.js'), 'export const host = true\n')
      await writeFile(join(packageDirectory, 'lib/client.js'), 'export const client = true\n')
      const fakePnpmPath = join(fakeBinDirectory, 'pnpm')
      await writeFile(fakePnpmPath, `#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const destination = process.argv[process.argv.indexOf('--pack-destination') + 1]
mkdirSync(destination, { recursive: true })
execFileSync('tar', ['-czf', join(destination, 'fixture.tgz'), '-C', process.env.ARKME_FAKE_PACKAGE_ROOT, 'package'])
`)
      await chmod(fakePnpmPath, 0o755)

      const stdout = execFileSync(process.execPath, [
        join(process.cwd(), 'scripts/build-runtime-artifact.mjs'),
        '--output-dir', outputDirectory,
      ], {
        cwd: projectDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}`,
          ARKME_FAKE_PACKAGE_ROOT: fixtureDirectory,
        },
      })

      const metadata = JSON.parse(await readFile(join(outputDirectory, 'artifact-metadata.json'), 'utf8'))
      expect(metadata.version).toBe('0.1.77')
      expect(metadata.file).toBe('dsh-arkme-0.1.77.tar.zst')
      expect(stdout).toContain(join(outputDirectory, 'dsh-arkme-0.1.77.tar.zst'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects archive paths that the backend would classify as traversal entries', () => {
    expect(() => validateRuntimeArchiveEntries([
      ...runtimeRequiredEntries,
      './unexpected.js',
    ])).toThrow('archive path traversal entry: ./unexpected.js')
    expect(() => validateRuntimeArchiveEntries([
      ...runtimeRequiredEntries,
      '../outside.js',
    ])).toThrow('archive path traversal entry: ../outside.js')
  })

  it('rejects an artifact when a Release Set required entry is missing', () => {
    expect(() => validateRuntimeArchiveEntries([
      'package.json',
      'cordis.patch.yml',
      'lib/index.js',
    ])).toThrow('required archive entry is missing: lib/client.js')
  })

  it('rejects symbolic links before creating the runtime archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-runtime-symlink-'))
    const packageDirectory = join(root, 'package')
    try {
      await mkdir(join(packageDirectory, 'lib'), { recursive: true })
      await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({
        name: '@senguoyun/dsh-arkme',
        version: '0.1.78',
      }))
      await writeFile(join(packageDirectory, 'cordis.patch.yml'), 'version: 1\n')
      await writeFile(join(packageDirectory, 'lib/index.js'), 'export const host = true\n')
      await writeFile(join(packageDirectory, 'lib/client.js'), 'export const client = true\n')
      await symlink('index.js', join(packageDirectory, 'lib/linked.js'))

      await expect(createRuntimeArchive({
        packageDirectory,
        outputDirectory: join(root, 'output'),
      })).rejects.toThrow('runtime artifact must not contain a symbolic link: lib/linked.js')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
