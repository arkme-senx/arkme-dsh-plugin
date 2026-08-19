import { describe, expect, it } from 'vitest'
import * as pluginEntry from '../src/index.js'

type RunResult = { exitCode: number; stdout: string; stderr: string }
type RunCall = { args: readonly string[]; stdin?: string }
type AdapterFactory = (options: {
  profile: string
  run: (args: readonly string[], options?: { stdin?: string }) => Promise<RunResult>
}) => {
  preflight: () => Promise<{ status: string; version?: string; gateway?: string }>
}

function adapterFactory(): AdapterFactory {
  return (pluginEntry as unknown as { createOpenClawCliAdapter: AdapterFactory }).createOpenClawCliAdapter
}

describe('OpenClawCliAdapter', () => {
  it('uses only fixed commands and SecretRef metadata while provisioning', async () => {
    const calls: RunCall[] = []
    const adapter = adapterFactory()({
      profile: 'dev',
      async run(args, options) {
        calls.push({ args: [...args], ...options })
        const command = args.slice(2).join(' ')
        if (command === 'plugins inspect jotmo-openclaw-channel --json') return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === 'agents list --json') return { exitCode: 0, stdout: '[{"id":"arkme-bot-abc-extra"}]', stderr: '' }
        if (command.startsWith('config get channels.jotmo.accounts.')) return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === 'agents bindings --json') return { exitCode: 0, stdout: '[]', stderr: '' }
        return { exitCode: 0, stdout: '{}', stderr: '' }
      },
    }) as unknown as import('../src/openclaw/index.js').OpenClawCliPort

    await expect(adapter.inspect({ agentId: 'arkme-bot-abc', accountId: 'arkme-bot-abc' })).resolves.toEqual({ channel: false, agent: false, account: false, binding: false })
    await adapter.ensureChannel()
    await adapter.ensureAgent({ agentId: 'arkme-bot-abc', workspaceRef: '/owned/arkme-bot-abc' })
    await adapter.ensureAccountSecretRef({ accountId: 'arkme-bot-abc', secretRef: { provider: 'arkme-bot-abc', source: 'file', id: 'value', providerPath: '/owned/secrets/abc.secret' } })
    await adapter.ensureBinding({ agentId: 'arkme-bot-abc', accountId: 'arkme-bot-abc' })

    expect(calls.map(call => call.args.slice(2))).toContainEqual(['plugins', 'install', '@jotmo/openclaw-channel@0.1.12', '--pin'])
    expect(calls.map(call => call.args.slice(2))).toContainEqual(['agents', 'add', 'arkme-bot-abc', '--non-interactive', '--workspace', '/owned/arkme-bot-abc', '--json'])
    expect(calls.map(call => call.args.slice(2))).toContainEqual(['config', 'set', 'secrets.providers.arkme-bot-abc', '--provider-source', 'file', '--provider-path', '/owned/secrets/abc.secret', '--provider-mode', 'singleValue'])
    expect(calls.map(call => call.args.slice(2))).toContainEqual(['agents', 'bind', '--agent', 'arkme-bot-abc', '--bind', 'jotmo:arkme-bot-abc', '--json'])
    expect(calls.every(call => call.stdin === undefined)).toBe(true)
  })
  it('rejects an empty host-configured profile without invoking OpenClaw', async () => {
    const calls: RunCall[] = []
    const createAdapter = adapterFactory()
    const adapter = createAdapter({
      profile: '   ',
      async run(args) {
        calls.push({ args: [...args] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })

    await expect(adapter.preflight()).resolves.toEqual({ status: 'profile_not_found' })
    expect(calls).toEqual([])
  })

  it('returns profile_not_found without running model or mutation commands', async () => {
    const calls: RunCall[] = []
    const createAdapter = adapterFactory()
    expect(createAdapter).toBeTypeOf('function')
    const adapter = createAdapter({
      profile: 'missing-profile',
      async run(args, options) {
        calls.push({ args: [...args], ...options })
        if (args.includes('config') && args.includes('file')) {
          return { exitCode: 0, stdout: '~/.openclaw-missing-profile/openclaw.json\n', stderr: '' }
        }
        if (args.includes('config') && args.includes('validate')) {
          return { exitCode: 1, stdout: '', stderr: 'Config file not found: ~/.openclaw-missing-profile/openclaw.json' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })

    await expect(adapter.preflight()).resolves.toEqual({ status: 'profile_not_found' })
    expect(calls).toEqual([
      { args: ['--profile', 'missing-profile', 'config', 'file'] },
      { args: ['--profile', 'missing-profile', 'config', 'validate'] },
    ])
  })

  it('uses one fixed profile and only read-only commands for a healthy preflight', async () => {
    const calls: RunCall[] = []
    const createAdapter = adapterFactory()
    expect(createAdapter).toBeTypeOf('function')
    const adapter = createAdapter({
      profile: 'dev',
      async run(args, options) {
        calls.push({ args: [...args], ...options })
        const command = args.slice(2).join(' ')
        if (command === 'config file') return { exitCode: 0, stdout: '/tmp/openclaw-dev.json\n', stderr: '' }
        if (command === '--version') return { exitCode: 0, stdout: 'OpenClaw 2026.7.1-2 (0790d9f)\n', stderr: '' }
        if (command === 'config validate') return { exitCode: 0, stdout: 'valid\n', stderr: '' }
        if (command === 'models status') return { exitCode: 0, stdout: 'Default : deepseek/deepseek-v4-flash\nAuth: yes\n', stderr: '' }
        if (command === 'gateway status') return { exitCode: 0, stdout: 'Connectivity probe: ok\n', stderr: '' }
        return { exitCode: 2, stdout: '', stderr: `unexpected command: ${command}` }
      },
    })

    await expect(adapter.preflight()).resolves.toEqual({
      status: 'ready',
      version: '2026.7.1-2',
      gateway: 'reachable',
    })
    expect(calls).toEqual([
      { args: ['--profile', 'dev', 'config', 'file'] },
      { args: ['--profile', 'dev', 'config', 'validate'] },
      { args: ['--profile', 'dev', '--version'] },
      { args: ['--profile', 'dev', 'models', 'status'] },
      { args: ['--profile', 'dev', 'gateway', 'status'] },
    ])
    expect(calls.every(call => call.stdin === undefined)).toBe(true)
  })

  it('rejects a default model whose provider authentication is missing', async () => {
    const createAdapter = adapterFactory()
    const adapter = createAdapter({
      profile: 'unconfigured',
      async run(args) {
        const command = args.slice(2).join(' ')
        if (command === 'config file') return { exitCode: 0, stdout: '/tmp/openclaw.json\n', stderr: '' }
        if (command === 'config validate') return { exitCode: 0, stdout: 'valid\n', stderr: '' }
        if (command === '--version') return { exitCode: 0, stdout: 'OpenClaw 2026.7.1-2\n', stderr: '' }
        if (command === 'models status') {
          return {
            exitCode: 0,
            stdout: 'Default : openai/gpt-5.5\nRuntime auth\n- openai effective=missing:missing\nMissing auth\n- openai configure credentials\n',
            stderr: '',
          }
        }
        return { exitCode: 2, stdout: '', stderr: `unexpected command: ${command}` }
      },
    })

    await expect(adapter.preflight()).resolves.toEqual({
      status: 'prerequisite_failed',
      reason: 'model_auth',
    })
  })

  it('rejects an OpenClaw version outside the locally verified 2026.7 line', async () => {
    const createAdapter = adapterFactory()
    const adapter = createAdapter({
      profile: 'future',
      async run(args) {
        const command = args.slice(2).join(' ')
        if (command === 'config file') return { exitCode: 0, stdout: '/tmp/openclaw.json\n', stderr: '' }
        if (command === 'config validate') return { exitCode: 0, stdout: 'valid\n', stderr: '' }
        if (command === '--version') return { exitCode: 0, stdout: 'OpenClaw 2026.8.0\n', stderr: '' }
        return { exitCode: 2, stdout: '', stderr: `unexpected command: ${command}` }
      },
    })

    await expect(adapter.preflight()).resolves.toEqual({
      status: 'prerequisite_failed',
      reason: 'version',
    })
  })

  it('reports an offline gateway separately from satisfied prerequisites', async () => {
    const createAdapter = adapterFactory()
    const adapter = createAdapter({
      profile: 'configured-offline',
      async run(args) {
        const command = args.slice(2).join(' ')
        if (command === 'config file') return { exitCode: 0, stdout: '/tmp/openclaw.json\n', stderr: '' }
        if (command === 'config validate') return { exitCode: 0, stdout: 'valid\n', stderr: '' }
        if (command === '--version') return { exitCode: 0, stdout: 'OpenClaw 2026.7.1-2\n', stderr: '' }
        if (command === 'models status') return { exitCode: 0, stdout: 'Default : deepseek/deepseek-chat\n', stderr: '' }
        if (command === 'gateway status') return { exitCode: 0, stdout: 'Connectivity probe: failed\n', stderr: '' }
        return { exitCode: 2, stdout: '', stderr: `unexpected command: ${command}` }
      },
    })

    await expect(adapter.preflight()).resolves.toEqual({
      status: 'ready',
      version: '2026.7.1-2',
      gateway: 'unreachable',
    })
  })
})
