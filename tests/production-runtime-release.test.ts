import { execFile } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const exec = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '..')
const directories: string[] = []
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Runtime test', GIT_AUTHOR_EMAIL: 'runtime@example.invalid',
  GIT_COMMITTER_NAME: 'Runtime test', GIT_COMMITTER_EMAIL: 'runtime@example.invalid',
}
const git = (cwd: string, ...args: string[]) => exec('git', args, { cwd, env: gitEnv })
const workflow = async (name: string) => parse(await readFile(join(repositoryRoot, '.github/workflows', name), 'utf8'))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arkme-production-release-'))
  directories.push(root)
  const source = join(root, 'source')
  const checkout = join(root, 'checkout')
  const origin = join(root, 'origin.git')
  const bin = join(root, 'bin')
  await mkdir(source)
  await mkdir(bin)
  for (const command of ['npm', 'gh']) {
    await writeFile(join(bin, command), '#!/bin/sh\necho "Registry or GitHub Release access is unavailable" >&2\nexit 99\n')
    await chmod(join(bin, command), 0o755)
  }
  await git(root, 'init', '--bare', '--initial-branch=master', origin)
  await git(source, 'init', '--initial-branch=master')
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@senguoyun/dsh-arkme', version: '0.1.45' }))
  await git(source, 'add', 'package.json')
  await git(source, 'commit', '-m', 'initial')
  await git(source, 'remote', 'add', 'origin', origin)
  await git(source, 'push', 'origin', 'master')
  await git(root, 'clone', origin, checkout)
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@senguoyun/dsh-arkme', version: '0.1.46' }))
  await git(source, 'add', 'package.json')
  await git(source, 'commit', '-m', 'prepared release')
  await git(source, 'push', 'origin', 'master')
  const sha = (await git(source, 'rev-parse', 'HEAD')).stdout.trim()
  return { root, source, checkout, origin, bin, sha }
}

async function validateRelease(project: Awaited<ReturnType<typeof fixture>>, env = {}) {
  const definition = await workflow('publish-production-runtime.yml')
  const step = definition.jobs['publish-runtime'].steps.find((step: { name?: string }) => /验证.*版本与提交/.test(step.name ?? ''))
  return exec('bash', ['-eo', 'pipefail', '-c', step.run], {
    cwd: project.checkout,
    env: { ...gitEnv, PATH: `${project.bin}:${process.env.PATH}`, RELEASE_SHA: project.sha, VERSION: '0.1.46', ...env },
  })
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('production Runtime release without npm publication', () => {
  it.each([
    { master: '0.1.46', npm: '0.1.45', reserved: true, next: '0.1.47' },
    { master: '0.2.0', npm: '0.1.45', reserved: false, next: '0.2.0' },
  ])('prepares $next from master $master with reserved=$reserved and npm $npm', async (release) => {
    const project = await fixture()
    await mkdir(join(project.checkout, 'scripts'))
    await copyFile(join(repositoryRoot, 'scripts/prepare-plugin-release.mjs'), join(project.checkout, 'scripts/prepare-plugin-release.mjs'))
    await writeFile(join(project.checkout, 'package.json'), JSON.stringify({
      name: '@senguoyun/dsh-arkme', version: release.master, arkme: { updateNotice: {} },
    }))
    await writeFile(join(project.bin, 'npm'), `#!/usr/bin/env node
if (process.argv[2] !== 'view') process.exit(99)
if (process.argv[3] !== '@senguoyun/dsh-arkme@latest') process.exit(1)
console.log(process.env.FIXTURE_NPM_VERSION)
`)
    await writeFile(join(project.bin, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2)
for (const [key, value] of [['--base', 'master'], ['--head', 'release/v' + process.env.FIXTURE_MASTER_VERSION], ['--state', 'merged']]) {
  if (args[args.indexOf(key) + 1] !== value) process.exit(99)
}
if (process.env.FIXTURE_RESERVED === 'true') console.log('123')
`)
    const definition = await workflow('publish-plugin-release.yml')
    const step = definition.jobs.prepare.steps.find((step: { id?: string }) => step.id === 'release')
    const output = join(project.root, 'outputs')
    await exec('bash', ['-eo', 'pipefail', '-c', step.run], {
      cwd: project.checkout,
      env: {
        ...gitEnv, PATH: `${project.bin}:${process.env.PATH}`, GH_REPO: 'arkme-senx/arkme-dsh-plugin',
        MERGED_PR_TITLE: 'parallel release', GITHUB_OUTPUT: output,
        FIXTURE_NPM_VERSION: release.npm, FIXTURE_MASTER_VERSION: release.master, FIXTURE_RESERVED: String(release.reserved),
      },
    })
    expect(JSON.parse(await readFile(join(project.checkout, 'package.json'), 'utf8')).version).toBe(release.next)
    expect(await readFile(output, 'utf8')).toContain(`next_version=${release.next}\n`)
  })

  it.each(['AUTOMATIC_RELEASE_SHA', 'EXISTING_RELEASE_SHA'])('exports the exact prepared commit version using %s', async (sourceKey) => {
    const project = await fixture()
    const definition = await workflow('publish-plugin-release.yml')
    const step = definition.jobs.prepare.steps.find((step: { id?: string }) => step.id === 'result')
    const output = join(project.root, 'outputs')
    await exec('bash', ['-eo', 'pipefail', '-c', step.run], {
      cwd: project.checkout,
      env: { ...gitEnv, AUTOMATIC_RELEASE_SHA: '', EXISTING_RELEASE_SHA: '', [sourceKey]: project.sha, GITHUB_OUTPUT: output },
    })
    expect(await readFile(output, 'utf8')).toBe(`release_sha=${project.sha}\nversion=0.1.46\n`)
    expect(JSON.parse(await readFile(join(project.checkout, 'package.json'), 'utf8')).version).toBe('0.1.45')
  })

  it('accepts an exact master commit without npm, a Tag, or a GitHub Release', async () => {
    const project = await fixture()
    await expect(validateRelease(project)).resolves.toMatchObject({ stderr: expect.any(String) })
    expect((await git(project.checkout, 'tag', '--list')).stdout).toBe('')
  })

  it('dispatches the prepared version and SHA without any npm publish output', async () => {
    const project = await fixture()
    const payloadPath = join(project.root, 'dispatch.json')
    await writeFile(join(project.bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs')
const expected = ['api', '--method', 'POST', 'repos/arkme-senx/arkme-dsh-plugin/dispatches', '--input', '-']
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(99)
fs.writeFileSync(process.env.FIXTURE_DISPATCH_REQUEST, fs.readFileSync(0))
`)
    const definition = await workflow('publish-plugin-release.yml')
    const step = definition.jobs['dispatch-runtime-publish'].steps[0]
    await exec('bash', ['-eo', 'pipefail', '-c', step.run], {
      cwd: project.checkout,
      env: {
        ...gitEnv, PATH: `${project.bin}:${process.env.PATH}`, GH_REPO: 'arkme-senx/arkme-dsh-plugin',
        RELEASE_SHA: project.sha, VERSION: '0.1.46', FIXTURE_DISPATCH_REQUEST: payloadPath,
      },
    })
    expect(JSON.parse(await readFile(payloadPath, 'utf8'))).toEqual({
      event_type: 'arkme-plugin-release-prepared', client_payload: { release_sha: project.sha, version: '0.1.46' },
    })
  })

  it.each([
    { RELEASE_SHA: 'not-a-sha' },
    { VERSION: '0.1.46-pre.1' },
    { VERSION: '0.1.47' },
  ])('rejects invalid or mismatched release input %j', async (env) => {
    const project = await fixture()
    await expect(validateRelease(project, env)).rejects.toMatchObject({ code: 1 })
  })

  it('rejects a release SHA outside master history', async () => {
    const project = await fixture()
    await git(project.source, 'switch', '-c', 'unmerged')
    await writeFile(join(project.source, 'unmerged.txt'), 'not approved for production')
    await git(project.source, 'add', 'unmerged.txt')
    await git(project.source, 'commit', '-m', 'unmerged change')
    const sha = (await git(project.source, 'rev-parse', 'HEAD')).stdout.trim()
    await git(project.source, 'push', 'origin', 'unmerged')
    await git(project.checkout, 'fetch', 'origin', 'unmerged')
    await expect(validateRelease(project, { RELEASE_SHA: sha })).rejects.toThrow('发布提交不属于当前 master 历史')
  })
})
