import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
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
    accountGateway: false,
    binding: false,
  }
  const cli: OpenClawCliPort = {
    async preflight() { return { status: 'ready', version: '2026.7.1-2', gateway: 'reachable' } },
    async inspect() { calls.push('inspect'); return resources },
    async ensureChannel(input) {
      calls.push(`channel:${input.installed ? 'update' : 'install'}:${input.targetVersion}`)
      resources = { ...resources, channel: true, channelVersion: input.targetVersion }
      return { changed: true, installedVersion: input.targetVersion }
    },
    async ensureAgent(input) { calls.push(`agent:${input.agentId}:${input.workspaceRef}`); resources = { ...resources, agent: true }; return { changed: true } },
    async ensureAccountSecretRef(input) { calls.push(`account:${input.accountId}:${input.secretRef.provider}`); resources = { ...resources, account: true }; return { changed: true } },
    async ensureAccountGatewayUrl(input) { calls.push(`gateway-url:${input.accountId}:${input.gatewayUrl}`); resources = { ...resources, accountGateway: true }; return { changed: true } },
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
    async matchesPreview() { return true },
    async isRestartRequired() { return restartRequired },
    async markRestartRequired() { restartRequired = true },
    async clearRestartRequired() { restartRequired = false },
  }
}

describe('OpenClawProvisioner', () => {
  it('checks only non-mutating local prerequisites before Chat-owned Bot creation', async () => {
    const secretStore = secretStoreFixture()
    const missing = fixture({ async preflight() { return { status: 'profile_not_found' } } })
    const blocked = createOpenClawProvisioner({ cli: missing.cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })
    await expect(blocked.chatOwnedCreatePreflight()).resolves.toEqual({ status: 'blocked', reason: 'profile' })

    const readyFixture = fixture()
    const ready = createOpenClawProvisioner({ cli: readyFixture.cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })
    await expect(ready.chatOwnedCreatePreflight()).resolves.toEqual({ status: 'ready' })
  })

  it('upgrades an installed stale Channel before touching Bot secrets', async () => {
    const { cli, calls, setResources } = fixture()
    setResources({ channel: true, channelVersion: '0.1.12', agent: true, account: true, accountGateway: true, binding: true })
    let reveals = 0
    const provisioner = createOpenClawProvisioner({ cli, secretStore: secretStoreFixture(), workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({
      botRef: 'opaque.bot.alpha', runtimeContract: 'chat_direct_v1',
      resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'unused' }),
      revealSecret: async () => { reveals += 1; return new SecretValue('unused') },
    })).resolves.toMatchObject({ status: 'gateway_restart_confirmation_required' })
    expect(calls).toEqual(['inspect', 'channel:update:0.1.13'])
    expect(reveals).toBe(0)
  })

  it('fails closed when the pinned Channel still lacks the required Chat owner contract', async () => {
    const { cli, calls } = fixture({
      async ensureChannel(input) {
        calls.push(`channel:${input.installed ? 'update' : 'install'}:${input.targetVersion}`)
        return { changed: true, installedVersion: '0.1.12' }
      },
    })
    let reveals = 0
    const provisioner = createOpenClawProvisioner({ cli, secretStore: secretStoreFixture(), workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({
      botRef: 'opaque.bot.alpha', runtimeContract: 'chat_direct_v1',
      resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'unused' }),
      revealSecret: async () => { reveals += 1; return new SecretValue('unused') },
    })).resolves.toEqual({ status: 'prerequisite_failed', reason: 'channel_contract' })
    expect(calls).toEqual(['inspect', 'channel:install:0.1.13'])
    expect(reveals).toBe(0)
  })

  it('keeps a missing Subject-owner Channel on the existing stable version', async () => {
    const { cli, calls } = fixture()
    const provisioner = createOpenClawProvisioner({
      cli, secretStore: secretStoreFixture(), workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false,
    })

    await expect(provisioner.reconcile({
      botRef: 'opaque.subject.bot',
      runtimeContract: 'subject_private_v1',
      resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'unused' }),
      revealSecret: async () => new SecretValue('unused'),
    })).resolves.toMatchObject({ status: 'gateway_restart_confirmation_required' })
    expect(calls[0]).toBe('inspect')
    expect(calls[1]).toBe('channel:install:0.1.12')
  })

  it('stops at preflight without reading or persisting a Bot secret', async () => {
    const writes: string[] = []
    const secretStore = secretStoreFixture()
    secretStore.persist = async () => { writes.push('secret'); return { provider: 'x', source: 'file', id: 'value', providerPath: '/secret' } }
    const { cli } = fixture({ async preflight() { return { status: 'profile_not_found' } } })
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', runtimeContract: 'subject_private_v1', resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'never' }), revealSecret: async () => new SecretValue('never') }))
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
    const result = await provisioner.reconcile({ botRef: 'opaque.bot.alpha', runtimeContract: 'subject_private_v1', resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'top-secr...cret' }), revealSecret: async () => new SecretValue('top-secret') })

    expect(result).toMatchObject({ status: 'gateway_restart_confirmation_required' })
    expect(JSON.stringify(result)).not.toContain('top-secret')
    expect(calls.join('\n')).not.toContain('top-secret')
    expect(captured).toHaveLength(1)
    const agentId = calls[2]?.split(':')[1]
    expect(agentId).toMatch(/^arkme-bot-[a-f0-9]{16}$/)
    expect(calls[2]).toBe(`agent:${agentId}:${join('/owned/workspaces', agentId as string)}`)
  })

  it('reuses complete resources without retrieving or rewriting the secret', async () => {
    const { cli, calls, setResources } = fixture()
    setResources({ channel: true, agent: true, account: true, accountGateway: true, binding: true })
    let reveals = 0
    const secretStore = secretStoreFixture()
    secretStore.persist = async () => { throw new Error('must not persist') }
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => true })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', runtimeContract: 'subject_private_v1', resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'unused' }), revealSecret: async () => { reveals++; return new SecretValue('unused') } }))
      .resolves.toMatchObject({ status: 'runtime_online' })
    expect(reveals).toBe(0)
    expect(calls).toEqual(['inspect'])
  })

  it('resumes partial state and does not delete resources when a later stage fails', async () => {
    const { cli, calls, setResources } = fixture({ async ensureBinding() { calls.push('binding-failed'); throw new Error('bind failed') } })
    setResources({ channel: true, agent: true, account: false, accountGateway: false, binding: false })
    const secretStore = secretStoreFixture()
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', runtimeContract: 'subject_private_v1', resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'secret' }), revealSecret: async () => new SecretValue('secret') }))
      .rejects.toThrow('bind failed')
    expect(calls).toEqual([
      'inspect',
      'account:arkme-bot-902c9cd4cd1d2046:arkme',
      'gateway-url:arkme-bot-902c9cd4cd1d2046:wss://bot.test/ws/v1/bot/gateway',
      'binding-failed',
    ])
    expect(calls.some(call => call.includes('delete'))).toBe(false)
  })

  it('isolates different Bot references', async () => {
    const ids: string[] = []
    const run = async (botRef: string) => {
      const { cli } = fixture({ async ensureAgent(input) { ids.push(input.agentId); return { changed: true } } })
      const secretStore = secretStoreFixture()
      return createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })
        .reconcile({ botRef, runtimeContract: 'subject_private_v1', resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'secret' }), revealSecret: async () => new SecretValue('secret') })
    }
    await run('opaque.bot.alpha')
    await run('opaque.bot.beta')
    expect(new Set(ids).size).toBe(2)
  })

  it('does not confuse a reachable Gateway with the Bot runtime being online', async () => {
    const { cli, setResources } = fixture()
    setResources({ channel: true, agent: true, account: true, accountGateway: true, binding: true })
    const secretStore = secretStoreFixture()
    secretStore.persist = async () => { throw new Error('must not persist') }
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', runtimeContract: 'subject_private_v1', resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'unused' }), revealSecret: async () => new SecretValue('unused') }))
      .resolves.toMatchObject({ status: 'connected_unverified' })
  })

  it('applies the Gateway restart inside the already-confirmed reconciliation', async () => {
    const { cli, calls } = fixture()
    const secretStore = secretStoreFixture()
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => true })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', runtimeContract: 'subject_private_v1', allowGatewayRestart: true, resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'secret' }), revealSecret: async () => new SecretValue('secret') }))
      .resolves.toMatchObject({ status: 'runtime_online' })
    expect(calls).toContain('restart')
  })

  it('keeps the restart marker and reports an actionable prerequisite when Gateway is not service-managed', async () => {
    const { cli, calls, setResources } = fixture({
      async restartGateway() { calls.push('restart'); return 'service_not_installed' },
    })
    setResources({ channel: true, agent: true, account: true, accountGateway: true, binding: true })
    const secretStore = secretStoreFixture()
    await secretStore.markRestartRequired('902c9cd4cd1d2046')
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({ botRef: 'opaque.bot.alpha', runtimeContract: 'subject_private_v1', allowGatewayRestart: true, resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'unused' }), revealSecret: async () => new SecretValue('unused') }))
      .resolves.toEqual({ status: 'prerequisite_failed', reason: 'gateway_service' })
    expect(await secretStore.isRestartRequired('902c9cd4cd1d2046')).toBe(true)
  })

  it('repairs a missing account Gateway URL without revealing or rewriting the Bot token', async () => {
    const { cli, calls, setResources } = fixture()
    setResources({ channel: true, agent: true, account: true, accountGateway: false, binding: true })
    let reveals = 0
    const secretStore = secretStoreFixture()
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({
      botRef: 'opaque.bot.alpha',
      runtimeContract: 'subject_private_v1',
      resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'unused' }),
      revealSecret: async () => { reveals++; return new SecretValue('unused') },
    })).resolves.toMatchObject({ status: 'gateway_restart_confirmation_required' })
    expect(reveals).toBe(0)
    expect(calls).toContain('gateway-url:arkme-bot-902c9cd4cd1d2046:wss://bot.test/ws/v1/bot/gateway')
  })

  it('refreshes an owned stale SecretRef only when the owner token preview changed', async () => {
    const { cli, setResources } = fixture()
    setResources({ channel: true, agent: true, account: true, accountGateway: true, binding: true })
    let persisted = 0
    const secretStore: OpenClawSecretStore = {
      ...secretStoreFixture(),
      async matchesPreview() { return false },
      async persist() { persisted++; return { provider: 'arkme', source: 'file', id: 'value', providerPath: '/secret' } },
    }
    const provisioner = createOpenClawProvisioner({ cli, secretStore, workspaceRoot: '/owned/workspaces', isRuntimeOnline: async () => false })

    await expect(provisioner.reconcile({
      botRef: 'opaque.bot.alpha',
      runtimeContract: 'subject_private_v1',
      resolveConnectionMetadata: async () => ({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'new-toke...oken' }),
      revealSecret: async () => new SecretValue('new-token'),
    })).resolves.toMatchObject({ status: 'gateway_restart_confirmation_required' })
    expect(persisted).toBe(1)
  })
})
