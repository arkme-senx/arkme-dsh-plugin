import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const triggerScript = path.join(
  repositoryRoot,
  '.github',
  'scripts',
  'request-arkme-build.sh',
)
const releaseWorkflow = path.join(
  repositoryRoot,
  '.github',
  'workflows',
  'publish-plugin-release.yml',
)
const preReleaseWorkflow = path.join(
  repositoryRoot,
  '.github',
  'workflows',
  'request-pre-release-build.yml',
)
const productionWorkflow = path.join(
  repositoryRoot,
  '.github',
  'workflows',
  'request-production-build.yml',
)
const codeOwnersFile = path.join(repositoryRoot, '.github', 'CODEOWNERS')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

async function runTrigger(options: {
  baseUrl?: string
  body?: string
  curlExitCode?: number
  httpStatus?: string
  secret?: string
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'arkme-jenkins-trigger-'))
  temporaryDirectories.push(directory)
  const argumentsFile = path.join(directory, 'curl-arguments')
  const fakeCurl = path.join(directory, 'curl')
  await writeFile(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
: > "$FAKE_CURL_ARGUMENTS_FILE"
output_file=''
while (($#)); do
  printf '%s\\n' "$1" >> "$FAKE_CURL_ARGUMENTS_FILE"
  if [[ "$1" == '--output' ]]; then
    output_file="$2"
    shift
    printf '%s\\n' "$1" >> "$FAKE_CURL_ARGUMENTS_FILE"
  fi
  shift
done
if [[ -n "$output_file" ]]; then
  printf '%s' "$FAKE_CURL_BODY" > "$output_file"
fi
printf '%s' "$FAKE_CURL_HTTP_STATUS"
exit "$FAKE_CURL_EXIT_CODE"
`,
  )
  await chmod(fakeCurl, 0o755)

  const result = spawnSync('bash', [triggerScript], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ARKME_BACKEND_BASE_URL: options.baseUrl ?? 'https://backend.example.com',
      ARKME_CI_TRIGGER_SECRET: options.secret ?? 'synthetic-test-secret',
      FAKE_CURL_ARGUMENTS_FILE: argumentsFile,
      FAKE_CURL_BODY: options.body ?? '{"queued":true}',
      FAKE_CURL_EXIT_CODE: String(options.curlExitCode ?? 0),
      FAKE_CURL_HTTP_STATUS: options.httpStatus ?? '202',
      PATH: `${directory}:${process.env.PATH ?? ''}`,
    },
  })

  let curlArguments = ''
  try {
    curlArguments = await readFile(argumentsFile, 'utf8')
  } catch {
    // 地址预检失败时不会执行 curl，也不会生成参数文件。
  }
  return { ...result, curlArguments }
}

describe('Arkme Backend 安全构建请求脚本', () => {
  it('仅在 Backend 返回 202 且 queued=true 时成功', async () => {
    const result = await runTrigger()

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Arkme 构建请求已由 Backend 接受并进入队列。\n')
    expect(result.stderr).toBe('')
    expect(result.curlArguments).toContain('--proto\n=https\n')
    expect(result.curlArguments).toContain('--tlsv1.2\n')
    expect(result.curlArguments).toContain('--max-redirs\n0\n')
    expect(result.curlArguments).toContain('--request\nPOST\n')
    expect(result.curlArguments).toContain(
      'Authorization: Bearer synthetic-test-secret\n',
    )
    expect(result.curlArguments).toContain(
      'https://backend.example.com/api/public/v1/ci/arkme-plugin/build\n',
    )
    expect(result.curlArguments).not.toContain('--retry\n')
    expect(result.curlArguments).not.toContain('--show-error\n')
  })

  it.each([
    'http://backend.example.com',
    'https://user@backend.example.com',
    'https://backend.example.com/path',
    'https://backend.example.com?target=other',
  ])('在发送密钥前拒绝不安全的 Backend 地址：%s', async (baseUrl) => {
    const result = await runTrigger({ baseUrl })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Backend 地址必须是')
    expect(result.curlArguments).toBe('')
  })

  it('Backend 未确认 queued=true 时失败且不输出响应正文', async () => {
    const sensitiveResponse = '{"queued":false,"jenkins":"internal-job-name"}'
    const result = await runTrigger({ body: sensitiveResponse })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('未确认任务进入队列')
    expect(result.stderr).not.toContain(sensitiveResponse)
    expect(result.stdout).toBe('')
  })

  it('Backend 返回错误状态时只输出脱敏状态', async () => {
    const result = await runTrigger({
      body: '{"error":"internal upstream details"}',
      httpStatus: '403',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('HTTP 403')
    expect(result.stderr).not.toContain('internal upstream details')
    expect(result.stdout).toBe('')
  })

  it('网络失败时不重试且不泄露密钥', async () => {
    const secret = 'network-failure-secret'
    const result = await runTrigger({ curlExitCode: 28, secret })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Backend 请求未完成')
    expect(result.stderr).not.toContain(secret)
    expect(result.stdout).toBe('')
    expect(result.curlArguments).not.toContain('--retry\n')
  })

  it('在发送请求前拒绝包含换行的密钥', async () => {
    const secret = 'header-injection\r\nX-Internal: exposed'
    const result = await runTrigger({ secret })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('触发密钥格式无效')
    expect(result.stderr).not.toContain(secret)
    expect(result.curlArguments).toBe('')
  })
})

describe('Arkme Backend 构建请求工作流安全边界', () => {
  it('npm 发布沿用受信任的 pull_request OIDC 身份并从默认分支派发生产构建', async () => {
    const release = await readFile(releaseWorkflow, 'utf8')
    const production = await readFile(productionWorkflow, 'utf8')
    const dispatchJob = release.slice(
      release.indexOf('  dispatch-backend-build:'),
      release.indexOf('  sync-dev:'),
    )

    expect(release).toContain('  pull_request:\n')
    expect(release).not.toContain('pull_request_target:')
    expect(dispatchJob).toContain('needs: [prepare, publish]')
    expect(dispatchJob).toContain("if: needs.publish.result == 'success'")
    expect(dispatchJob).toContain('contents: write')
    expect(dispatchJob).toContain('arkme-plugin-release-published')
    expect(dispatchJob).toContain('RELEASE_SHA: ${{ needs.prepare.outputs.release_sha }}')
    expect(dispatchJob).toContain('VERSION: ${{ needs.publish.outputs.version }}')
    expect(dispatchJob).not.toContain('secrets.')

    expect(production).toContain('repository_dispatch:')
    expect(production).toContain('types: [arkme-plugin-release-published]')
    expect(production).toContain('environment: production')
    expect(production).toContain('contents: read')
    expect(production).toContain('ref: master')
    expect(production).toContain('persist-credentials: false')
    expect(production).toContain('git merge-base --is-ancestor "$RELEASE_SHA" origin/master')
    expect(production).toContain('git rev-parse "${tag}^{commit}"')
    expect(production).toContain('gh release view "$tag"')
    expect(production).toContain('npm view "${package_name}@${VERSION}" version')
    expect(production).toContain(
      'ARKME_BACKEND_BASE_URL: ${{ secrets.ARKME_BACKEND_BASE_URL }}',
    )
    expect(production).toContain(
      'ARKME_CI_TRIGGER_SECRET: ${{ secrets.ARKME_CI_TRIGGER_SECRET }}',
    )
    expect(production).not.toContain('vars.ARKME_BACKEND_BASE_URL')
    expect(production).toContain(
      'run: bash .github/scripts/request-arkme-build.sh',
    )
  })

  it('生产构建工作流只检出默认分支的受信任脚本', async () => {
    const workflow = await readFile(productionWorkflow, 'utf8')

    expect(workflow).toContain('ref: master')
    expect(workflow).not.toContain(
      'ref: ${{ github.event.pull_request.head.sha }}',
    )
    expect(workflow).not.toContain('pull_request_target')
    expect(workflow).not.toContain('github.event.pull_request.head')
  })

  it('仅在受保护的 pre-release 更新后使用测试服 Environment Secret', async () => {
    const workflow = await readFile(preReleaseWorkflow, 'utf8')

    expect(workflow).toContain('push:')
    expect(workflow).toContain('branches: [pre-release]')
    expect(workflow).toContain(
      'name: 调用 Backend 请求 Arkme 测试服构建',
    )
    expect(workflow).toContain('environment: pre-release')
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('ref: ${{ github.sha }}')
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toContain(
      'ARKME_BACKEND_BASE_URL: ${{ secrets.ARKME_BACKEND_BASE_URL }}',
    )
    expect(workflow).toContain(
      'ARKME_CI_TRIGGER_SECRET: ${{ secrets.ARKME_CI_TRIGGER_SECRET }}',
    )
    expect(workflow).toContain(
      'run: bash .github/scripts/request-arkme-build.sh',
    )
    expect(workflow).not.toContain('pull_request_target')
    expect(workflow).not.toContain('vars.ARKME_BACKEND_BASE_URL')
    expect(workflow).not.toContain('npm publish')
  })

  it('要求指定 Code Owner 审核 CI 和密钥出口文件', async () => {
    const codeOwners = await readFile(codeOwnersFile, 'utf8')

    expect(codeOwners).toContain('/.github/CODEOWNERS @SimonHe-1D3E')
    expect(codeOwners).toContain('/.github/workflows/ @SimonHe-1D3E')
    expect(codeOwners).toContain('/.github/scripts/ @SimonHe-1D3E')
  })
})
