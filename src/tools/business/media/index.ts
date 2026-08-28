import type { ArkmeToolModule } from '../../contract/module.js'
import { aiVideoToolModule } from './ai-video.js'
import { readImageToolModule } from './read-image.js'
import { textAiVideoToolModule } from './text-ai-video.js'
import { fileToolModules } from './files.js'

export const mediaBusinessToolModules: readonly ArkmeToolModule[] = [aiVideoToolModule, textAiVideoToolModule, readImageToolModule, ...fileToolModules]

export { aiVideoRequestIdForToolCall, aiVideoToolModule, createArkmeAiVideoToolDefinition } from './ai-video.js'
export type { ArkmeAiVideoService } from './ai-video.js'
export { createArkmeTextAiVideoToolDefinition, textAiVideoRequestIdForToolCall, textAiVideoToolModule } from './text-ai-video.js'
export type { ArkmeTextAiVideoService } from './text-ai-video.js'
export { createArkmeImageToolDefinition } from './read-image.js'
export type { ArkmeImageReadService } from './read-image.js'
