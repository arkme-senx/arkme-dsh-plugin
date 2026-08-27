import type { ArkmeToolModule } from '../../contract/module.js'
import { voiceprintGrantsToolModule } from './grants.js'
import { voiceprintInviteToolModule } from './invite.js'
import { voiceprintRecognizedPeopleToolModule } from './recognized-people.js'
import { voiceprintRecognizedInviteToolModule } from './recognized-invite.js'
import { voiceprintRestoreToolModule } from './restore.js'
import { voiceprintRevokeToolModule } from './revoke.js'
import { voiceprintStatusToolModule } from './status.js'

export const voiceprintToolModules: readonly ArkmeToolModule[] = [
  voiceprintStatusToolModule,
  voiceprintGrantsToolModule,
  voiceprintRecognizedPeopleToolModule,
  voiceprintRecognizedInviteToolModule,
  voiceprintInviteToolModule,
  voiceprintRevokeToolModule,
  voiceprintRestoreToolModule,
]
