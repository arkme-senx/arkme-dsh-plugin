import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { describe, it, expect } from 'vitest'

const workflow = parse(readFileSync(resolve('.github/workflows/publish-plugin-release.yml'), 'utf8'))
const command = workflow.jobs.publish.steps.find((step: any) => step.id === 'npm').run

describe('npm publish recovery workflow', () => {
  it.each([
    ['staged conflict', 'npm error code E409\nnpm error 409 Cannot publish over previously staged version "0.1.58".', 1, true],
    ['published conflict', 'npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 0.1.58.', 1, true],
    ['network timeout', 'npm error code ETIMEDOUT', 1, true],
    ['connection reset', 'npm error code ECONNRESET', 1, true],
    ['bounded command timeout', '', 124, true],
    ['successful publish', '', 0, true],
    ['permission denied', 'npm error code E403\nnpm error 403 Forbidden', 1, false],
    ['unrelated conflict', 'npm error code E409\nnpm error 409 unrelated conflict', 1, false],
    ['invalid token', 'npm error code E401', 1, false],
    ['already published, same content', 'must not publish', 99, true, 'sha512-match'],
    ['already published, different content', 'must not publish', 1, false, 'sha512-other'],
  ])('%s', (_label, message, status, recover, existingIntegrity) => {
    const dir = mkdtempSync(join(tmpdir(), 'npm-recovery-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@senguoyun/dsh-arkme', version: '0.1.58' }))
      writeFileSync(join(dir, 'npm'), `#!/bin/sh
if [ "$1" = view ]; then
  [ -n "$TEST_EXISTING_INTEGRITY" ] || exit 1
  if [ "$3" = version ]; then echo 0.1.58; else echo "$TEST_EXISTING_INTEGRITY"; fi
  exit 0
fi
touch "$TEST_PUBLISH_MARKER"
printf "%s\\n" "$TEST_NPM_MESSAGE" >&2
exit "$TEST_NPM_STATUS"
`, { mode: 0o755 })
      // macOS lacks GNU timeout; simulate its exit status without a real publication.
      writeFileSync(join(dir, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 })
      const output = join(dir, 'output')
      writeFileSync(output, '')
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output,
          TEST_NPM_MESSAGE: message, TEST_NPM_STATUS: String(status), TEST_EXISTING_INTEGRITY: existingIntegrity ?? '',
          TEST_PUBLISH_MARKER: join(dir, 'published'), RELEASE_TARBALL: 'release.tgz', RELEASE_INTEGRITY: 'sha512-match' },
      })
      expect(result.status, result.stderr).toBe(recover ? 0 : status)
      expect(readFileSync(output, 'utf8')).toBe(recover ? 'package_name=@senguoyun/dsh-arkme\nversion=0.1.58\n' : '')
      expect(existsSync(join(dir, 'published'))).toBe(!existingIntegrity)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
