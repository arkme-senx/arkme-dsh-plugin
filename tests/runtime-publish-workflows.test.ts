import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = (name: string) => readFile(path.join(repositoryRoot, '.github', 'workflows', name), 'utf8')

describe('Arkme runtime publish workflow boundaries', () => {
  it.each([
    ['publish-plugin-release.yml', 'prepare'],
    ['publish-plugin-release.yml', 'publish'],
    ['publish-production-runtime.yml', 'publish-runtime'],
    ['publish-pre-release-runtime.yml', 'build-runtime'],
    ['prepare-plugin-release.yml', 'prepare'],
  ])('builds explicitly once and skips lifecycle builds in %s / %s', async (file, jobName) => {
    const definition = parse(await workflow(file))
    const job = definition.jobs[jobName]
    const commands: string[] = []
    for (const step of job.steps) {
      if (!step.run) continue
      const env = { ...definition.env, ...job.env, ...step.env }
      if (/pnpm (install|test|run)/.test(step.run)) {
        expect(env.ARKME_SKIP_PREPARE_BUILD).toBe('true')
      }
      commands.push(...step.run.split('\n').map((line: string) => line.trim()))
    }
    expect(commands.filter(line => line === 'pnpm run build')).toHaveLength(1)
    expect(commands.filter(line => line.startsWith('pnpm install'))).toEqual(['pnpm install --frozen-lockfile'])
    const build = commands.indexOf('pnpm run build')
    const pack = commands.findIndex(line => /^(pnpm run pack:runtime|npm pack)/.test(line))
    if (pack !== -1) expect(pack).toBeGreaterThan(build)
  })

  it.each(['publish-plugin-release.yml', 'prepare-plugin-release.yml'])(
    'writes release metadata before dependency installation in %s', async (file) => {
      const definition = parse(await workflow(file))
      const steps = definition.jobs.prepare.steps
      const version = steps.findIndex((step: { run?: string }) => step.run?.includes('node scripts/prepare-plugin-release.mjs'))
      const install = steps.findIndex((step: { run?: string }) => step.run?.includes('pnpm install'))
      const tests = steps.findIndex((step: { run?: string }) => step.run?.includes('pnpm test'))
      expect(version).toBeGreaterThan(-1)
      expect(install).toBeGreaterThan(version)
      expect(tests).toBeGreaterThan(install)
    },
  )

  it.each([
    ['publish-production-runtime.yml', 'publish-runtime', 'false'],
    ['publish-pre-release-runtime.yml', 'build-runtime', 'true'],
  ])('keeps the independent Runtime test switch in %s', async (file, jobName, defaultValue) => {
    const definition = parse(await workflow(file))
    expect(definition.env.RUN_TESTS).toBe(defaultValue)
    const tests = definition.jobs[jobName].steps.filter((step: { run?: string }) => step.run === 'pnpm test')
    expect(tests).toHaveLength(1)
    expect(tests[0].if).toBe("env.RUN_TESTS == 'true'")
  })

  it('runs tests while preparing the release but not while publishing npm', async () => {
    const release = await workflow('publish-plugin-release.yml')

    expect(release.match(/pnpm test/g)).toHaveLength(1)
    expect(release.indexOf('pnpm test')).toBeLessThan(release.indexOf('  publish:'))
  })

  it('starts npm publishing and production runtime dispatch independently after prepare', async () => {
    const release = await workflow('publish-plugin-release.yml')
    const definition = parse(release)
    const dispatchJob = definition.jobs['dispatch-runtime-publish']
    const dispatch = dispatchJob.steps[0]

    expect(release).toContain('  pull_request:\n')
    expect(release).not.toContain('pull_request_target:')
    expect(definition.jobs.publish.needs).toBe('prepare')
    expect(dispatchJob.needs).toBe('prepare')
    expect(dispatchJob.if).toBe("needs.prepare.result == 'success'")
    expect(definition.jobs.prepare.outputs.version).toBe('${{ steps.result.outputs.version }}')
    expect(dispatch.env.RELEASE_SHA).toBe('${{ needs.prepare.outputs.release_sha }}')
    expect(dispatch.env.VERSION).toBe('${{ needs.prepare.outputs.version }}')
    expect(JSON.stringify(dispatchJob)).not.toMatch(/needs\.publish|secrets\./)
    const production = parse(await workflow('publish-production-runtime.yml'))
    expect(production.on.repository_dispatch.types).toContain('arkme-plugin-release-prepared')
    expect(dispatch.run).toContain('arkme-plugin-release-prepared')
  })

  it('validates the trusted production release before building its exact SHA', async () => {
    const production = await workflow('publish-production-runtime.yml')
    const validation = production.indexOf('name: 验证生产版本与提交')
    const exactCheckout = production.indexOf('git checkout --detach "$RELEASE_SHA"')
    const publish = production.indexOf('node scripts/publish-runtime-artifact.mjs')

    expect(production).toContain('repository_dispatch:')
    expect(parse(production).on.repository_dispatch.types).toContain('arkme-plugin-release-published')
    expect(production).toContain('group: plugin-production-runtime-publish')
    expect(production).toContain('queue: max')
    expect(production).toContain('cancel-in-progress: false')
    expect(production).toContain('environment: production')
    expect(production).toContain('contents: read')
    expect(production).toContain('ref: master')
    expect(production).toContain('persist-credentials: false')
    expect(production).toContain('git merge-base --is-ancestor "$RELEASE_SHA" origin/master')
    expect(validation).toBeGreaterThan(0)
    expect(exactCheckout).toBeGreaterThan(validation)
    expect(publish).toBeGreaterThan(exactCheckout)
    expect(production).toContain('pnpm test')
    expect(production).toContain('pnpm run typecheck')
    expect(production).toContain('pnpm run build')
    expect(production).toContain('pnpm run pack:runtime')
    expect(production).toContain('ARKME_RELEASE_SOURCE_SHA: ${{ github.event.client_payload.release_sha }}')
    expect(production).toContain('ARKME_BACKEND_BASE_URL: ${{ secrets.ARKME_BACKEND_BASE_URL }}')
    expect(production).toContain('ARKME_CI_TRIGGER_SECRET: ${{ secrets.ARKME_CI_TRIGGER_SECRET }}')
    expect(production).toContain('DEBUG: ""')
    expect(production).not.toContain('vars.ARKME_BACKEND_BASE_URL')
    expect(production).not.toContain('request-arkme-build.sh')
    expect(production).not.toContain('/arkme-plugin/build')
  })

  it('builds a serial next-patch pre-release from the exact pushed SHA without npm publishing', async () => {
    const preRelease = await workflow('publish-pre-release-runtime.yml')
    const buildStart = preRelease.indexOf('  build-runtime:')
    const publishStart = preRelease.indexOf('  publish-runtime:')
    const buildJob = preRelease.slice(buildStart, publishStart)
    const publishJob = preRelease.slice(publishStart)

    expect(preRelease).toContain('push:')
    expect(preRelease).toContain('branches: [pre-release]')
    expect(preRelease).toContain('group: plugin-pre-release-runtime-publish')
    expect(preRelease).toContain('queue: max')
    expect(preRelease).toContain('cancel-in-progress: false')
    expect(buildStart).toBeGreaterThan(0)
    expect(publishStart).toBeGreaterThan(buildStart)
    expect(buildJob).not.toContain('environment: pre-release')
    expect(buildJob).not.toContain('secrets.')
    expect(buildJob).toContain('uses: actions/upload-artifact@v4')
    expect(publishJob).toContain('needs: build-runtime')
    expect(publishJob).toContain('environment: pre-release')
    expect(publishJob).toContain('ref: master')
    expect(publishJob).toContain('uses: actions/download-artifact@v4')
    expect(publishJob).toContain('ARKME_RUNTIME_ARTIFACT_DIR: trusted-runtime-artifact')
    expect(preRelease).toContain('contents: read')
    expect(preRelease).toContain('ref: ${{ github.sha }}')
    expect(preRelease).toContain('persist-credentials: false')
    expect(preRelease).toContain('node scripts/prepare-runtime-version.mjs --run-number "$GITHUB_RUN_NUMBER"')
    expect(preRelease).toContain('pnpm test')
    expect(preRelease).toContain('pnpm run typecheck')
    expect(preRelease).toContain('pnpm run build')
    expect(preRelease).toContain('pnpm run pack:runtime')
    expect(preRelease).toContain('node scripts/publish-runtime-artifact.mjs')
    expect(preRelease).toContain('ARKME_RELEASE_SOURCE_SHA: ${{ github.sha }}')
    expect(preRelease).toContain('ARKME_BACKEND_BASE_URL: ${{ secrets.ARKME_BACKEND_BASE_URL }}')
    expect(preRelease).toContain('ARKME_CI_TRIGGER_SECRET: ${{ secrets.ARKME_CI_TRIGGER_SECRET }}')
    expect(publishJob).toContain('DEBUG: ""')
    expect(preRelease).not.toContain('pull_request_target')
    expect(preRelease).not.toContain('vars.ARKME_BACKEND_BASE_URL')
    expect(preRelease).not.toContain('npm publish')
    expect(preRelease).not.toContain('request-arkme-build.sh')
    expect(preRelease).not.toContain('/arkme-plugin/build')
    expect(preRelease.indexOf('pnpm test')).toBeLessThan(
      preRelease.indexOf('node scripts/prepare-runtime-version.mjs'),
    )
    expect(preRelease.indexOf('node scripts/prepare-runtime-version.mjs')).toBeLessThan(
      preRelease.indexOf('pnpm run build'),
    )
  })

  it('requires code-owner review for workflows and scripts that can access publishing secrets', async () => {
    const codeOwners = await readFile(path.join(repositoryRoot, '.github', 'CODEOWNERS'), 'utf8')

    expect(codeOwners).toContain('/.github/CODEOWNERS @SimonHe-1D3E')
    expect(codeOwners).toContain('/.github/workflows/ @SimonHe-1D3E')
    expect(codeOwners).toContain('/.github/scripts/ @SimonHe-1D3E')
    expect(codeOwners).toContain('/scripts/publish-runtime-artifact.mjs @SimonHe-1D3E')
    expect(codeOwners).toContain('/package.json @SimonHe-1D3E')
    expect(codeOwners).toContain('/pnpm-lock.yaml @SimonHe-1D3E')
  })
})
