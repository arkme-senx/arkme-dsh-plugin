import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = (name: string) => readFile(path.join(repositoryRoot, '.github', 'workflows', name), 'utf8')

describe('Arkme runtime publish workflow boundaries', () => {
  it('dispatches production runtime publishing only after npm release succeeds', async () => {
    const release = await workflow('publish-plugin-release.yml')
    const dispatchJob = release.slice(
      release.indexOf('  dispatch-runtime-publish:'),
      release.indexOf('  sync-dev:'),
    )

    expect(release).toContain('  pull_request:\n')
    expect(release).not.toContain('pull_request_target:')
    expect(dispatchJob).toContain('needs: [prepare, publish]')
    expect(dispatchJob).toContain("if: needs.publish.result == 'success'")
    expect(dispatchJob).toContain('arkme-plugin-release-published')
    expect(dispatchJob).toContain('RELEASE_SHA: ${{ needs.prepare.outputs.release_sha }}')
    expect(dispatchJob).toContain('VERSION: ${{ needs.publish.outputs.version }}')
    expect(dispatchJob).not.toContain('secrets.')
  })

  it('validates the trusted production release before building its exact SHA', async () => {
    const production = await workflow('publish-production-runtime.yml')
    const validation = production.indexOf('name: 验证已发布版本与提交')
    const exactCheckout = production.indexOf('git checkout --detach "$RELEASE_SHA"')
    const publish = production.indexOf('node scripts/publish-runtime-artifact.mjs')

    expect(production).toContain('repository_dispatch:')
    expect(production).toContain('types: [arkme-plugin-release-published]')
    expect(production).toContain('group: plugin-production-runtime-publish')
    expect(production).toContain('queue: max')
    expect(production).toContain('cancel-in-progress: false')
    expect(production).toContain('environment: production')
    expect(production).toContain('contents: read')
    expect(production).toContain('ref: master')
    expect(production).toContain('persist-credentials: false')
    expect(production).toContain('git merge-base --is-ancestor "$RELEASE_SHA" origin/master')
    expect(production).toContain('git rev-parse "${tag}^{commit}"')
    expect(production).toContain('gh release view "$tag"')
    expect(production).toContain('npm view "${package_name}@${VERSION}" version')
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
