import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createOpenClawCliAdapter } from '../src/openclaw/index.js'

const integration = process.env.ARKME_OPENCLAW_RECONCILE_INTEGRATION === '1' ? describe : describe.skip

integration('isolated OpenClaw reconciliation profile', () => {
  it('recognizes the pinned Channel, isolated Agent, SecretRef account and binding', async () => {
    const adapter = createOpenClawCliAdapter({
      profile: process.env.ARKME_OPENCLAW_PROFILE?.trim() || 'arkme-dsh-spike',
      async run(args) {
        return await new Promise(resolve => {
          const { VITEST: _vitest, VITEST_POOL_ID: _poolId, ...childEnv } = process.env
          execFile('openclaw', [...args], { timeout: 30_000, maxBuffer: 1024 * 1024, env: childEnv }, (error, stdout, stderr) => {
            resolve({ exitCode: typeof error?.code === 'number' ? error.code : error === null ? 0 : 1, stdout, stderr })
          })
        })
      },
    })
    await expect(adapter.inspect({ agentId: 'arkme-bot-alpha', accountId: 'arkme-bot-alpha' })).resolves.toEqual({
      channel: true, agent: true, account: true, binding: true,
    })
  }, 120_000)
})
