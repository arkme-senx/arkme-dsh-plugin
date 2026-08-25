import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const helperPath = join(process.cwd(), 'lib', 'plugin-updater-helper.js')
const result = spawnSync(process.execPath, [helperPath], {
  encoding: 'utf8',
  timeout: 10_000,
})
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

if (result.status === 0 || !output.includes('updater plan path is required')) {
  throw new Error('built plugin updater helper is not an executable entrypoint')
}
