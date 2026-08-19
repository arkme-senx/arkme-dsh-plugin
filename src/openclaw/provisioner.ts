import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { SecretValue } from '../secret-value.js'
import type { OpenClawCliPort, OpenClawProvisionResult, OpenClawSecretStore } from './types.js'

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
    async reconcile(input: { botRef: string; revealSecret: () => Promise<SecretValue> }): Promise<OpenClawProvisionResult> {
      const preflight = await options.cli.preflight()
      if (preflight.status !== 'ready') return preflight
      const hash = resourceHash(input.botRef)
      const resourceRef = `openclaw.bot.v1.${hash}`
      const agentId = `arkme-bot-${hash}`
      const accountId = agentId
      const current = await options.cli.inspect({ agentId, accountId })
      await options.secretStore.ensureOwnership({ resourceHash: hash, localResourceExists: current.agent })
      let changed = false
      if (!current.channel) changed = (await options.cli.ensureChannel()).changed || changed
      if (!current.agent) changed = (await options.cli.ensureAgent({ agentId, workspaceRef: join(options.workspaceRoot, agentId) })).changed || changed
      if (!current.account) {
        const secretRef = await options.secretStore.persist({ resourceHash: hash, secret: await input.revealSecret() })
        changed = (await options.cli.ensureAccountSecretRef({ accountId, secretRef })).changed || changed
      }
      if (!current.binding) changed = (await options.cli.ensureBinding({ agentId, accountId })).changed || changed
      const gateway = await options.cli.gatewayStatus()
      if (changed) return { status: 'gateway_restart_confirmation_required', resource_ref: resourceRef, impact: 'profile_all_agents' }
      if (gateway === 'reachable') {
        const runtimeOnline = await options.isRuntimeOnline(input.botRef)
        return { status: runtimeOnline ? 'runtime_online' : 'connected_unverified', resource_ref: resourceRef }
      }
      if (gateway === 'unreachable') return { status: 'local_configured', resource_ref: resourceRef }
      return { status: 'connected_unverified', resource_ref: resourceRef }
    },
  }
}
