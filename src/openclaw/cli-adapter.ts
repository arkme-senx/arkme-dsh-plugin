export interface OpenClawCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface OpenClawCommandRunner {
  (args: readonly string[], options?: { stdin?: string; signal?: AbortSignal }): Promise<OpenClawCommandResult>
}

export type OpenClawPreflightResult =
  | { status: 'profile_not_found' }
  | { status: 'prerequisite_failed'; reason: 'binary' | 'version' | 'config' | 'model_auth' }
  | { status: 'ready'; version: string; gateway: 'reachable' | 'unreachable' | 'unknown' }

export interface OpenClawCliAdapter {
  preflight(options?: { signal?: AbortSignal }): Promise<OpenClawPreflightResult>
  inspect(input: { agentId: string; accountId: string }, options?: { signal?: AbortSignal }): Promise<import('./types.js').OpenClawLocalResources>
  ensureChannel(options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureAgent(input: { agentId: string; workspaceRef: string }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureAccountSecretRef(input: { accountId: string; secretRef: import('./types.js').OpenClawSecretRef }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  ensureBinding(input: { agentId: string; accountId: string }, options?: { signal?: AbortSignal }): Promise<{ changed: boolean }>
  gatewayStatus(options?: { signal?: AbortSignal }): Promise<'reachable' | 'unreachable' | 'unknown'>
  restartGateway(options?: { signal?: AbortSignal }): Promise<'restarted' | 'service_not_installed'>
}

const JOTMO_CHANNEL_PACKAGE = '@jotmo/openclaw-channel@0.1.12'

function assertSucceeded(result: OpenClawCommandResult, operation: string): void {
  if (result.exitCode !== 0) throw new Error(`OpenClaw ${operation} failed`)
}

function jsonContainsExactString(stdout: string, expected: string): boolean {
  let value: unknown
  try { value = JSON.parse(stdout) } catch { return false }
  const visit = (candidate: unknown): boolean => {
    if (candidate === expected) return true
    if (Array.isArray(candidate)) return candidate.some(visit)
    if (candidate !== null && typeof candidate === 'object') return Object.values(candidate).some(visit)
    return false
  }
  return visit(value)
}

function jsonHasBinding(stdout: string, agentId: string, accountId: string): boolean {
  let value: unknown
  try { value = JSON.parse(stdout) } catch { return false }
  if (!Array.isArray(value)) return false
  return value.some(candidate => {
    if (candidate === null || typeof candidate !== 'object') return false
    const binding = candidate as Record<string, unknown>
    const match = binding.match
    if (match === null || typeof match !== 'object') return false
    const route = match as Record<string, unknown>
    return binding.agentId === agentId && route.channel === 'jotmo' && route.accountId === accountId
  })
}

function profileArgs(profile: string, ...command: string[]): readonly string[] {
  return ['--profile', profile, ...command]
}

function parseVersion(stdout: string): string | undefined {
  return /OpenClaw\s+([^\s]+)/.exec(stdout)?.[1]
}

function parseGatewayReachability(result: OpenClawCommandResult): 'reachable' | 'unreachable' | 'unknown' {
  const output = `${result.stdout}\n${result.stderr}`
  if (/Reachable:\s*yes|Connect:\s*ok|Connectivity probe:\s*ok/i.test(output)) return 'reachable'
  if (/Reachable:\s*no|Connectivity probe:\s*failed|ECONNREFUSED/i.test(output)) return 'unreachable'
  return 'unknown'
}

export function createOpenClawCliAdapter(options: {
  profile: string
  run: OpenClawCommandRunner
}): OpenClawCliAdapter {
  const profile = options.profile.trim()
  return {
    async preflight(runOptions) {
      if (profile === '') return { status: 'profile_not_found' }

      const profileFile = await options.run(profileArgs(profile, 'config', 'file'), runOptions)
      if (profileFile.exitCode !== 0 || profileFile.stdout.trim() === '') {
        if (/ENOENT|command not found/i.test(profileFile.stderr)) return { status: 'prerequisite_failed', reason: 'binary' }
        return { status: 'profile_not_found' }
      }

      const configResult = await options.run(profileArgs(profile, 'config', 'validate'), runOptions)
      if (configResult.exitCode !== 0) {
        const configOutput = `${configResult.stdout}\n${configResult.stderr}`
        if (/config file not found/i.test(configOutput)) {
          return { status: 'profile_not_found' }
        }
        return { status: 'prerequisite_failed', reason: 'config' }
      }

      const versionResult = await options.run(profileArgs(profile, '--version'), runOptions)
      const version = versionResult.exitCode === 0 ? parseVersion(versionResult.stdout) : undefined
      if (version === undefined || !/^2026\.7\./.test(version)) {
        return { status: 'prerequisite_failed', reason: 'version' }
      }

      const modelResult = await options.run(profileArgs(profile, 'models', 'status'), runOptions)
      const modelOutput = `${modelResult.stdout}\n${modelResult.stderr}`
      const modelAuthMissing = /\bMissing auth\b/i.test(modelOutput) || /effective=missing(?::missing)?/i.test(modelOutput)
      if (modelResult.exitCode !== 0 || !/Default\s*:/i.test(modelResult.stdout) || modelAuthMissing) {
        return { status: 'prerequisite_failed', reason: 'model_auth' }
      }

      const gatewayResult = await options.run(profileArgs(profile, 'gateway', 'status'), runOptions)
      return { status: 'ready', version, gateway: parseGatewayReachability(gatewayResult) }
    },
    async inspect(input, runOptions) {
      const [channel, agents, account, bindings] = await Promise.all([
        options.run(profileArgs(profile, 'plugins', 'inspect', 'jotmo-openclaw-channel', '--json'), runOptions),
        options.run(profileArgs(profile, 'agents', 'list', '--json'), runOptions),
        options.run(profileArgs(profile, 'config', 'get', `channels.jotmo.accounts.${input.accountId}`), runOptions),
        options.run(profileArgs(profile, 'agents', 'bindings', '--json'), runOptions),
      ])
      return {
        channel: channel.exitCode === 0,
        agent: agents.exitCode === 0 && jsonContainsExactString(agents.stdout, input.agentId),
        account: account.exitCode === 0,
        binding: bindings.exitCode === 0 && jsonHasBinding(bindings.stdout, input.agentId, input.accountId),
      }
    },
    async ensureChannel(runOptions) {
      const result = await options.run(profileArgs(profile, 'plugins', 'install', JOTMO_CHANNEL_PACKAGE, '--pin'), runOptions)
      assertSucceeded(result, 'channel install')
      return { changed: true }
    },
    async ensureAgent(input, runOptions) {
      const result = await options.run(profileArgs(profile, 'agents', 'add', input.agentId, '--non-interactive', '--workspace', input.workspaceRef, '--json'), runOptions)
      assertSucceeded(result, 'agent creation')
      return { changed: true }
    },
    async ensureAccountSecretRef(input, runOptions) {
      const provider = await options.run(profileArgs(profile, 'config', 'set', `secrets.providers.${input.secretRef.provider}`, '--provider-source', 'file', '--provider-path', input.secretRef.providerPath, '--provider-mode', 'singleValue'), runOptions)
      assertSucceeded(provider, 'secret provider configuration')
      const account = await options.run(profileArgs(profile, 'config', 'set', `channels.jotmo.accounts.${input.accountId}.token`, '--ref-provider', input.secretRef.provider, '--ref-source', input.secretRef.source, '--ref-id', input.secretRef.id), runOptions)
      assertSucceeded(account, 'channel account configuration')
      return { changed: true }
    },
    async ensureBinding(input, runOptions) {
      const result = await options.run(profileArgs(profile, 'agents', 'bind', '--agent', input.agentId, '--bind', `jotmo:${input.accountId}`, '--json'), runOptions)
      assertSucceeded(result, 'agent binding')
      return { changed: true }
    },
    async gatewayStatus(runOptions) {
      return parseGatewayReachability(await options.run(profileArgs(profile, 'gateway', 'status'), runOptions))
    },
    async restartGateway(runOptions) {
      const status = await options.run(profileArgs(profile, 'gateway', 'status'), runOptions)
      if (/Service not installed/i.test(`${status.stdout}\n${status.stderr}`)) return 'service_not_installed'
      const result = await options.run(profileArgs(profile, 'gateway', 'restart'), runOptions)
      assertSucceeded(result, 'gateway restart')
      return 'restarted'
    },
  }
}
