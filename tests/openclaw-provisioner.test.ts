import { describe, expect, it } from 'vitest'
import { SecretValue } from '../src/secret-value.js'
import {
  createOpenClawProvisioner,
  type OpenClawCliPort,
  type OpenClawLocalResources,
  type OpenClawSecretStore,
} from '../src/openclaw/index.js'

function fixture(overrides: Partial<OpenClawCliPort> = {}) {
  const calls: string[] = []
  let resources: OpenClawLocalResources = {
    channel: false,
    agent: false,
    account: false,
    binding: false,
  }
  const cli: OpenClawCliPort = {
    async preflight() { return { status: 'ready', version: '2026.7.1-2', gateway: 'reachable' } },
    async inspect() { calls.push('inspect'); return resources },
    async ensureChannel() { calls.push('channel'); resources = { ...resources, channel: true }; return { changed: true } },
    async ensureAgent(input) { calls.push(`agent:${input.agentId}:${input.workspaceRef}`); resources = { ...resources, agent: true }; return { changed: true } },
    async ensureAccountSecretRef(input) { calls.push(`account:${input.accountId}:${input.secretRef.provider}`); resources = { ...resources, account: true }; return { changed: true } },
    async ensureBinding(input) { calls.push(`binding:${input.agentId}:${input.accountId}`); resources = { ...resources, binding: true }; return { changed: true } },
    async gatewayStatus() { return 'reachable' },
    async restartGateway() { calls.push('restart'); return 'restarted' as const },
    ...overrides,
  }
  return { cli, calls, setResources(value: OpenClawLocalResources) { resources = value } }
}

function secretStoreFixture(): OpenClawSecretStore {
  let restartRequired = false
  return {
    async ensureOwnership() {},
    async persist() { return { provider: 'arkme', source: 'file', id: 'value', providerPath: '/secret' } },
    async isRestartRequired() { return restartRequired },
    async markRestartRequired() { restartRequired = true },
    async clearRestartRequired() { restartRequired = false },
  }
}

describe('OpenClawProvisioner', () => {
  it('stops at preflight without reading or persisting a Bot secret', async () => {
    const writes: string[] = []
    const secretStore = secretStoreFixture()
    secretStore.persist = async () => { writes.push('secret'); return { provider: 'x', source: 'file', id: 'value', providerPath: '/secret' } }
    const { cli } = fixture({ async preflight() { return { status: 'profile_not_found' } } })
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', revealSecret: async () => new SecretValue('never') }))
      .resolves.toEqual({ status: 'profile_not_found' })
    expect(writes).toEqual([])
  })

  it('creates deterministic isolated resources and never exposes the secret', async () => {
    const { cli, calls } = fixture()
    const captured: SecretValue[] = []
    const secretStore: OpenClawSecretStore = {
      ...secretStoreFixture(),
      async ensureOwnership() {},
      async persist(input) {
        captured.push(input.secret)
        return { provider: `arkme-${input.resourceHash}`, source: 'file', id: 'value', providerPath: '/secret' }
      },
    }
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })
    const result = await provisioner.reconcile({ botRef: 'opaque.bot.alpha', revealSecret: async () => new SecretValue('top-secret') })

    expect(result).toMatchObject({ status: 'gateway_restart_confirmation_required' })
    expect(JSON.stringify(result)).not.toContain('top-secret')
    expect(calls.join('\n')).not.toContain('top-secret')
    expect(captured).toHaveLength(1)
    expect(calls[2]).toMatch(/^agent:arkme-bot-[a-f0-9]{16}:\/owned\/workspaces\/arkme-bot-[a-f0-9]{16}$/)
  })

  it('reuses complete resources without retrieving or rewriting the secret', async () => {
    const { cli, calls, setResources } = fixture()
    setResources({ channel: true, agent: true, account: true, binding: true })
    let reveals = 0
    const secretStore = secretStoreFixture()
    secretStore.persist = async () => { throw new Error('must not persist') }
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => true })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', revealSecret: async () => { reveals++; return new SecretValue('unused') } }))
      .resolves.toMatchObject({ status: 'runtime_online' })
    expect(reveals).toBe(0)
    expect(calls).toEqual(['inspect'])
  })

  it('resumes partial state and does not delete resources when a later stage fails', async () => {
    const { cli, calls, setResources } = fixture({ async ensureBinding() { calls.push('binding-failed'); throw new Error('bind failed') } })
    setResources({ channel: true, agent: true, account: false, binding: false })
    const secretStore = secretStoreFixture()
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', revealSecret: async () => new SecretValue('secret') }))
      .rejects.toThrow('bind failed')
    expect(calls).toEqual(['inspect', 'account:arkme-bot-902c9cd4cd1d2046:arkme', 'binding-failed'])
    expect(calls.some(call => call.includes('delete'))).toBe(false)
  })

  it('isolates different Bot references', async () => {
    const ids: string[] = []
    const run = async (botRef: string) => {
      const { cli } = fixture({ async ensureAgent(input) { ids.push(input.agentId); return { changed: true } } })
      const secretStore = secretStoreFixture()
      return createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })
        .reconcile({ botRef, revealSecret: async () => new SecretValue('secret') })
    }
    await run('opaque.bot.alpha')
    await run('opaque.bot.beta')
    expect(new Set(ids).size).toBe(2)
  })

  it('does not confuse a reachable Gateway with the Bot runtime being online', async () => {
    const { cli, setResources } = fixture()
    setResources({ channel: true, agent: true, account: true, binding: true })
    const secretStore = secretStoreFixture()
    secretStore.persist = async () => { throw new Error('must not persist') }
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', revealSecret: async () => new SecretValue('unused') }))
      .resolves.toMatchObject({ status: 'connected_unverified' })
  })

  it('restarts only on a later explicitly approved reconciliation', async () => {
    const { cli, calls } = fixture()
    const secretStore = secretStoreFixture()
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => true })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', allowGatewayRestart: true, revealSecret: async () => new SecretValue('secret') }))
      .resolves.toMatchObject({ status: 'gateway_restart_confirmation_required' })
    expect(calls).not.toContain('restart')

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', allowGatewayRestart: true, revealSecret: async () => new SecretValue('unused') }))
      .resolves.toMatchObject({ status: 'runtime_online' })
    expect(calls).toContain('restart')
  })

  it('keeps the restart marker and reports an actionable prerequisite when Gateway is not service-managed', async () => {
    const { cli, calls, setResources } = fixture({
      async restartGateway() { calls.push('restart'); return 'service_not_installed' },
    })
    setResources({ channel: true, agent: true, account: true, binding: true })
    const secretStore = secretStoreFixture()
    await secretStore.markRestartRequired('902c9cd4cd1d2046')
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', allowGatewayRestart: true, revealSecret: async () => new SecretValue('unused') }))
      .resolves.toEqual({ status: 'prerequisite_failed', reason: 'gateway_service' })
    expect(await secretStore.isRestartRequired('902c9cd4cd1d2046')).toBe(true)
  })
})
