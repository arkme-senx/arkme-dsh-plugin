import type { ArkmeToolModule } from '../contract/module.js'
import { pluginContractToolModule } from './plugin-contract.js'

export const systemToolModules: readonly ArkmeToolModule[] = [pluginContractToolModule]

export { consumerPluginContract } from './plugin-contract.js'
