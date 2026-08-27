import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePluginUpdateLifecycleLog } from '../src/plugin-update-lifecycle-log.js'

describe('plugin update lifecycle log', () => {
  it('redacts credentials from error details before appending to harness.log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-update-log-'))
    const logPath = join(root, 'harness.log')

    expect(writePluginUpdateLifecycleLog(logPath, {
      jobId: 'job-redaction',
      previousVersion: '0.1.17',
      targetVersion: '0.1.22',
    }, 'failed', {
      error: [
        'Bearer bearer-secret',
        'access_token=query-secret',
        'password=plain-secret',
        '_authToken=npm-secret',
        'client_secret: oauth-secret',
        'api_key=json-secret',
        '"authorization":"json-bearer-secret"',
        'cookie: session-secret',
        'https://user:pass@example.test/file?token=url-secret&X-Amz-Signature=signed-secret',
      ].join(' '),
    })).toBe(true)

    const line = await readFile(logPath, 'utf8')
    expect(line).not.toContain('bearer-secret')
    expect(line).not.toContain('query-secret')
    expect(line).not.toContain('plain-secret')
    expect(line).not.toContain('user:pass')
    expect(line).not.toContain('url-secret')
    expect(line).not.toContain('npm-secret')
    expect(line).not.toContain('oauth-secret')
    expect(line).not.toContain('json-secret')
    expect(line).not.toContain('json-bearer-secret')
    expect(line).not.toContain('session-secret')
    expect(line).not.toContain('signed-secret')
    expect(line).toContain('[REDACTED]')
  })
})
