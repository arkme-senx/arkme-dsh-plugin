import type { ArkmeToolModule } from '../../contract/module.js'
import { readImageToolModule } from './read-image.js'

export const mediaBusinessToolModules: readonly ArkmeToolModule[] = [readImageToolModule]

export { createArkmeImageToolDefinition } from './read-image.js'
export type { ArkmeImageReadService } from './read-image.js'
