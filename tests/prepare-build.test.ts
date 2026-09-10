import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const directories: string[] = []

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'arkme-prepare-build-'))
  directories.push(cwd)
  const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  await mkdir(join(cwd, 'scripts'))
  const prepareScript = join(repositoryRoot, 'scripts/prepare-build.mjs')
  if (existsSync(prepareScript)) await copyFile(prepareScript, join(cwd, 'scripts/prepare-build.mjs'))
  await writeFile(join(cwd, 'package.json'), JSON.stringify({
    name: '@senguoyun/dsh-arkme',
    version: '0.1.45',
    type: 'module',
    packageManager: manifest.packageManager,
    files: ['lib', 'cordis.patch.yml'],
    scripts: {
      prepare: manifest.scripts.prepare,
      postinstall: 'node scripts/postinstall.mjs',
      build: 'node scripts/build.mjs',
    },
  }))
  await writeFile(join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  await writeFile(join(cwd, 'cordis.patch.yml'), 'version: 1\n')
  await writeFile(join(cwd, 'scripts/postinstall.mjs'), `import { writeFileSync } from 'node:fs'
writeFileSync('postinstall-ran', 'true')
`)
  await writeFile(join(cwd, 'scripts/build.mjs'), `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
if (process.env.ARKME_FIXTURE_BUILD_FAIL === 'true') process.exit(7)
appendFileSync('builds.log', 'build\\n')
mkdirSync('lib', { recursive: true })
writeFileSync('lib/index.js', 'export const host = true\\n')
writeFileSync('lib/client.js', 'export const client = true\\n')
`)
  return cwd
}

function environment(skip?: string) {
  const env = { ...process.env }
  delete env.ARKME_SKIP_PREPARE_BUILD
  if (skip !== undefined) env.ARKME_SKIP_PREPARE_BUILD = skip
  return env
}

function pnpm(cwd: string, args: string[], skip?: string, extraEnv = {}) {
  const cli = process.env.npm_execpath
  return exec(cli ? process.execPath : 'pnpm', [...(cli ? [cli] : []), ...args], {
    cwd, env: { ...environment(skip), ...extraEnv },
  })
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(cwd => rm(cwd, { recursive: true, force: true })))
})

describe('prepare build lifecycle', () => {
  it.each([undefined, 'false', '1'])('keeps the default install build when the skip flag is %s', async (skip) => {
    const cwd = await fixture()
    await pnpm(cwd, ['install', '--offline'], skip)
    expect(await readFile(join(cwd, 'builds.log'), 'utf8')).toBe('build\n')
  }, 20_000)

  it('skips only the prepare build during CI installation', async () => {
    const cwd = await fixture()
    await pnpm(cwd, ['install', '--offline'], 'true')
    expect(existsSync(join(cwd, 'builds.log'))).toBe(false)
    expect(await readFile(join(cwd, 'postinstall-ran'), 'utf8')).toBe('true')
  }, 20_000)

  it('keeps local pack builds and packages identical bytes after one explicit CI build', async () => {
    const cwd = await fixture()
    await pnpm(cwd, ['pack', '--pack-destination', 'before'])
    expect(await readFile(join(cwd, 'builds.log'), 'utf8')).toBe('build\n')
    await pnpm(cwd, ['install', '--offline'], 'true')
    await pnpm(cwd, ['run', 'build'], 'true')
    await pnpm(cwd, ['pack', '--pack-destination', 'after'], 'true')
    expect(await readFile(join(cwd, 'builds.log'), 'utf8')).toBe('build\nbuild\n')
    const tarball = 'senguoyun-dsh-arkme-0.1.45.tgz'
    expect(await readFile(join(cwd, 'after', tarball))).toEqual(await readFile(join(cwd, 'before', tarball)))
  }, 30_000)

  it('propagates a build failure through the prepare lifecycle', async () => {
    const cwd = await fixture()
    const error = await pnpm(cwd, ['run', 'prepare'], undefined, { ARKME_FIXTURE_BUILD_FAIL: 'true' })
      .then(() => null, error => error)
    expect(error?.code).toBeGreaterThan(0)
  }, 20_000)

  it('rejects CI Runtime packaging when the explicit build was omitted', async () => {
    const cwd = await fixture()
    await pnpm(cwd, ['install', '--offline'], 'true')
    await expect(exec(process.execPath, [join(repositoryRoot, 'scripts/build-runtime-artifact.mjs')], {
      cwd, env: environment('true'),
    })).rejects.toThrow('required archive entry is missing: lib/index.js')
    expect(existsSync(join(cwd, 'dist/runtime-artifacts/artifact-metadata.json'))).toBe(false)
  }, 20_000)
})
