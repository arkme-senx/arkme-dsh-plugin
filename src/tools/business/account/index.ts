import type { ArkmeToolModule } from '../../contract/module.js'
import { userProfileToolModule } from './profile.js'

export const accountBusinessToolModules: readonly ArkmeToolModule[] = [userProfileToolModule]
