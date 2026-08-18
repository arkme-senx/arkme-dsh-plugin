import type { ArkmeToolModule } from '../../contract/module.js'
import { userProfileToolModule } from './profile.js'
import { setArkmeIdToolModule } from './set-id.js'

export const accountBusinessToolModules: readonly ArkmeToolModule[] = [userProfileToolModule, setArkmeIdToolModule]
