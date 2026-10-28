import { deviceLockToolModules } from './device-lock.js'
import { automaticCapabilityToolModules } from './automatic-capabilities.js'
import { aiPointsToolModules } from './ai-points.js'
import type { ArkmeToolModule } from '../../contract/module.js'
import { userProfileToolModule } from './profile.js'
import { setArkmeIdToolModule } from './set-id.js'
import { backgroundSoundPreferenceToolModules } from './background-sound.js'

export const accountBusinessToolModules: readonly ArkmeToolModule[] = [
  userProfileToolModule,
  ...deviceLockToolModules,
  ...aiPointsToolModules,
  ...automaticCapabilityToolModules,
  ...backgroundSoundPreferenceToolModules,
  setArkmeIdToolModule,
]
