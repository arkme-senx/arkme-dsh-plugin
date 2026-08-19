export interface OpenClawCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface OpenClawCommandRunner {
  (args: readonly string[], options?: { stdin?: string }): Promise<OpenClawCommandResult>
}

export type OpenClawPreflightResult =
  | { status: 'profile_not_found' }
  | { status: 'prerequisite_failed'; reason: 'version' | 'config' | 'model_auth' }
  | { status: 'ready'; version: string; gateway: 'reachable' | 'unreachable' | 'unknown' }

export interface OpenClawCliAdapter {
  preflight(): Promise<OpenClawPreflightResult>
  inspect(input: { agentId: string; accountId: string }): Promise<import('./types.js').OpenClawLocalResources>
  ensureChannel(): Promise<{ changed: boolean }>
  ensureAgent(input: { agentId: string; workspaceRef: string }): Promise<{ changed: boolean }>
  ensureAccountSecretRef(input: { accountId: string; secretRef: import('./types.js').OpenClawSecretRef }): Promise<{ changed: boolean }>
  ensureBinding(input: { agentId: string; accountId: string }): Promise<{ changed: boolean }>
  gatewayStatus(): Promise<'reachable' | 'unreachable' | 'unknown'>
  restartGateway(): Promise<void>
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
    async preflight() {
      if (profile === '') return { status: 'profile_not_found' }

      const profileFile = await options.run(profileArgs(profile, 'config', 'file'))
      if (profileFile.exitCode !== 0 || profileFile.stdout.trim() === '') {
        return { status: 'profile_not_found' }
      }

      const configResult = await options.run(profileArgs(profile, 'config', 'validate'))
      if (configResult.exitCode !== 0) {
        const configOutput = `${configResult.stdout}\n${configResult.stderr}`
        if (/config file not found/i.test(configOutput)) {
          return { status: 'profile_not_found' }
        }
        return { status: 'prerequisite_failed', reason: 'config' }
      }

      const versionResult = await options.run(profileArgs(profile, '--version'))
      const version = versionResult.exitCode === 0 ? parseVersion(versionResult.stdout) : undefined
      if (version === undefined || !/^2026\.7\./.test(version)) {
        return { status: 'prerequisite_failed', reason: 'version' }
      }

      const modelResult = await options.run(profileArgs(profile, 'models', 'status'))
      const modelOutput = `${modelResult.stdout}\n${modelResult.stderr}`
      const modelAuthMissing = /\bMissing auth\b/i.test(modelOutput) || /effective=missing(?::missing)?/i.test(modelOutput)
      if (modelResult.exitCode !== 0 || !/Default\s*:/i.test(modelResult.stdout) || modelAuthMissing) {
        return { status: 'prerequisite_failed', reason: 'model_auth' }
      }

      const gatewayResult = await options.run(profileArgs(profile, 'gateway', 'status'))
      return { status: 'ready', version, gateway: parseGatewayReachability(gatewayResult) }
    },
    async inspect(input) {
      const [channel, agents, account, bindings] = await Promise.all([
        options.run(profileArgs(profile, 'plugins', 'inspect', 'jotmo-openclaw-channel', '--json')),
        options.run(profileArgs(profile, 'agents', 'list', '--json')),
        options.run(profileArgs(profile, 'config', 'get', `channels.jotmo.accounts.${input.accountId}`)),
        options.run(profileArgs(profile, 'agents', 'bindings', '--json')),
      ])
      return {
        channel: channel.exitCode === 0,
        agent: agents.exitCode === 0 && jsonContainsExactString(agents.stdout, input.agentId),
        account: account.exitCode === 0,
        binding: bindings.exitCode === 0 && jsonContainsExactString(bindings.stdout, input.agentId) && jsonContainsExactString(bindings.stdout, `jotmo:${input.accountId}`),
      }
    },
    async ensureChannel() {
      const result = await options.run(profileArgs(profile, 'plugins', 'install', JOTMO_CHANNEL_PACKAGE, '--pin'))
      assertSucceeded(result, 'channel install')
      return { changed: true }
    },
    async ensureAgent(input) {
      const result = await options.run(profileArgs(profile, 'agents', 'add', input.agentId, '--non-interactive', '--workspace', input.workspaceRef, '--json'))
      assertSucceeded(result, 'agent creation')
      return { changed: true }
    },
    async ensureAccountSecretRef(input) {
      const provider = await options.run(profileArgs(profile, 'config', 'set', `secrets.providers.${input.secretRef.provider}`, '--provider-source', 'file', '--provider-path', input.secretRef.providerPath, '--provider-mode', 'singleValue'))
      assertSucceeded(provider, 'secret provider configuration')
      const account = await options.run(profileArgs(profile, 'config', 'set', `channels.jotmo.accounts.${input.accountId}.token`, '--ref-provider', input.secretRef.provider, '--ref-source', input.secretRef.source, '--ref-id', input.secretRef.id))
      assertSucceeded(account, 'channel account configuration')
      return { changed: true }
    },
    async ensureBinding(input) {
      const result = await options.run(profileArgs(profile, 'agents', 'bind', '--agent', input.agentId, '--bind', `jotmo:${input.accountId}`, '--json'))
      assertSucceeded(result, 'agent binding')
      return { changed: true }
    },
    async gatewayStatus() {
      return parseGatewayReachability(await options.run(profileArgs(profile, 'gateway', 'status')))
    },
    async restartGateway() {
      const result = await options.run(profileArgs(profile, 'gateway', 'restart'))
      assertSucceeded(result, 'gateway restart')
    },
  }
}
