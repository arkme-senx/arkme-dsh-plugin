import type { ArkmeToolModule } from '../../contract/module.js'
import { userProfileToolModule } from './profile.js'
import { setArkmeIdToolModule } from './set-id.js'
import { backgroundSoundPreferenceToolModules } from './background-sound.js'

export const accountBusinessToolModules: readonly ArkmeToolModule[] = [
  userProfileToolModule,
  ...backgroundSoundPreferenceToolModules,
  setArkmeIdToolModule,
]
