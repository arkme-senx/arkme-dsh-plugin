import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { SecretValue } from '../secret-value.js'
import type { OpenClawCliPort, OpenClawConnectionMetadata, OpenClawProvisionResult, OpenClawSecretStore } from './types.js'

function resourceHash(botRef: string): string {
  return createHash('sha256').update(`arkme-openclaw-bot:v1\0${botRef}`).digest('hex').slice(0, 16)
}

export function createOpenClawProvisioner(options: {
  cli: OpenClawCliPort
  secretStore: OpenClawSecretStore
  workspaceRoot: string
  isRuntimeOnline: (botRef: string) => Promise<boolean>
}) {
  return {
    async reconcile(input: { botRef: string; allowGatewayRestart?: boolean; resolveConnectionMetadata: () => Promise<OpenClawConnectionMetadata>; revealSecret: () => Promise<SecretValue>; signal?: AbortSignal }): Promise<OpenClawProvisionResult> {
      const runOptions = input.signal === undefined ? {} : { signal: input.signal }
      const preflight = await options.cli.preflight(runOptions)
      if (preflight.status !== 'ready') return preflight
      const hash = resourceHash(input.botRef)
      const resourceRef = `openclaw.bot.v1.${hash}`
      const agentId = `arkme-bot-${hash}`
      const accountId = agentId
      const { gatewayUrl, tokenPreview } = await input.resolveConnectionMetadata()
      const current = await options.cli.inspect({ agentId, accountId, gatewayUrl }, runOptions)
      await options.secretStore.ensureOwnership({ resourceHash: hash, localResourceExists: current.agent })
      let changed = false
      if (!current.channel) changed = (await options.cli.ensureChannel(runOptions)).changed || changed
      if (!current.agent) changed = (await options.cli.ensureAgent({ agentId, workspaceRef: join(options.workspaceRoot, agentId) }, runOptions)).changed || changed
      const secretMatches = current.account && await options.secretStore.matchesPreview(hash, tokenPreview)
      if (!current.account || !secretMatches) {
        const secretRef = await options.secretStore.persist({ resourceHash: hash, secret: await input.revealSecret(), tokenPreview })
        changed = true
        if (!current.account) changed = (await options.cli.ensureAccountSecretRef({ accountId, secretRef }, runOptions)).changed || changed
      }
      if (!current.accountGateway) changed = (await options.cli.ensureAccountGatewayUrl({ accountId, gatewayUrl }, runOptions)).changed || changed
      if (!current.binding) changed = (await options.cli.ensureBinding({ agentId, accountId }, runOptions)).changed || changed
      if (changed) {
        await options.secretStore.markRestartRequired(hash)
        return { status: 'gateway_restart_confirmation_required', resource_ref: resourceRef, impact: 'profile_all_agents' }
      }
      if (await options.secretStore.isRestartRequired(hash)) {
        if (input.allowGatewayRestart !== true) {
          return { status: 'gateway_restart_confirmation_required', resource_ref: resourceRef, impact: 'profile_all_agents' }
        }
        const restart = await options.cli.restartGateway(runOptions)
        if (restart === 'service_not_installed') {
          return { status: 'prerequisite_failed', reason: 'gateway_service' }
        }
        await options.secretStore.clearRestartRequired(hash)
      }
      const gateway = await options.cli.gatewayStatus(runOptions)
      if (gateway === 'reachable') {
        const runtimeOnline = await options.isRuntimeOnline(input.botRef)
        return { status: runtimeOnline ? 'runtime_online' : 'connected_unverified', resource_ref: resourceRef }
      }
      if (gateway === 'unreachable') return { status: 'local_configured', resource_ref: resourceRef }
      return { status: 'connected_unverified', resource_ref: resourceRef }
    },
  }
}
