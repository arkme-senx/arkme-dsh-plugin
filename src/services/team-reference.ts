import { createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { recordOwnerId } from '../record-owner-id.js'
import type { ServiceRuntime } from './service.js'

/** Issue the existing Team navigation reference from an owner-verified Team ID. */
export async function sealTeamReference(runtime: ServiceRuntime, teamId: unknown, viewer: number): Promise<string> {
  const id = recordOwnerId(teamId)
  if (!id) throw new Error('invalid Team reference')
  const codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), () => new Error('invalid Team reference'))
  return codec.seal('team-app-team', { team_id: id, viewer, environment: runtime.config.environment })
}

/** Same stable identity used by the Team contacts directory. */
export async function teamEntityKey(runtime: ServiceRuntime, teamId: unknown, viewer: number): Promise<string> {
  const id = recordOwnerId(teamId)
  if (!id) throw new Error('invalid Team identity')
  return createHmac('sha256', await runtime.stateStore.uniqueCode()).update(`team:${viewer}:team:${id}`).digest('hex')
}
