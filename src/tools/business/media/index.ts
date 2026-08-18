import type { ArkmeToolModule } from '../../contract/module.js'
import { aiVideoToolModule } from './ai-video.js'
import { readImageToolModule } from './read-image.js'

export const mediaBusinessToolModules: readonly ArkmeToolModule[] = [aiVideoToolModule, readImageToolModule]

export { aiVideoRequestIdForToolCall, aiVideoToolModule, createArkmeAiVideoToolDefinition } from './ai-video.js'
export type { ArkmeAiVideoService } from './ai-video.js'
export { createArkmeImageToolDefinition } from './read-image.js'
export type { ArkmeImageReadService } from './read-image.js'
