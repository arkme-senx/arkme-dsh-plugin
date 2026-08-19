import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createOpenClawCliAdapter } from '../src/openclaw/index.js'

const integration = process.env.ARKME_OPENCLAW_INTEGRATION === '1' ? describe : describe.skip

integration('local OpenClaw CLI', () => {
  it('validates the configured profile without invoking a model', async () => {
    const profile = process.env.ARKME_OPENCLAW_PROFILE?.trim() || 'dev'
    const observed: Array<{ args: readonly string[]; exitCode: number; stdout: string; stderr: string }> = []
    const adapter = createOpenClawCliAdapter({
      profile,
      async run(args) {
        return await new Promise((resolve) => {
          const { VITEST: _vitest, VITEST_POOL_ID: _poolId, ...childEnv } = process.env
          execFile('openclaw', [...args], {
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
            env: childEnv,
          }, (error, stdout, stderr) => {
            const commandResult = {
              exitCode: typeof error?.code === 'number' ? error.code : error === null ? 0 : 1,
              stdout,
              stderr,
            }
            observed.push({ args: [...args], ...commandResult })
            resolve(commandResult)
          })
        })
      },
    })

    const result = await adapter.preflight()
    expect(result.status, JSON.stringify(observed)).toBe('ready')
    expect(result).toHaveProperty('version')
  }, 120_000)
})
