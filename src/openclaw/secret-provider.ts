import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { OpenClawSecretStore } from './types.js'

export function createOpenClawFileSecretStore(options: { rootDir: string }): OpenClawSecretStore {
  return {
    async ensureOwnership({ resourceHash, localResourceExists }) {
      await mkdir(options.rootDir, { recursive: true, mode: 0o700 })
      const markerPath = join(options.rootDir, `${resourceHash}.owner.json`)
      try {
        const marker = JSON.parse(await readFile(markerPath, 'utf8')) as unknown
        if (JSON.stringify(marker) !== JSON.stringify({ schema_version: 1, owner: 'arkme-dsh-plugin', resource_hash: resourceHash })) {
          throw new Error('OpenClaw local resource owner marker mismatch')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (localResourceExists) throw new Error('OpenClaw local resource exists without an Arkme owner marker')
        const marker = JSON.stringify({ schema_version: 1, owner: 'arkme-dsh-plugin', resource_hash: resourceHash })
        const file = await open(markerPath, 'wx', 0o600)
        try { await file.writeFile(marker, 'utf8'); await file.sync() } finally { await file.close() }
      }
    },
    async persist({ resourceHash, secret }) {
      await mkdir(options.rootDir, { recursive: true, mode: 0o700 })
      const finalPath = join(options.rootDir, `${resourceHash}.secret`)
      const temporaryPath = join(options.rootDir, `.${resourceHash}.${randomUUID()}.tmp`)
      try {
        const file = await open(temporaryPath, 'wx', 0o600)
        try {
          await file.writeFile(secret.reveal(), 'utf8')
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temporaryPath, finalPath)
        await chmod(finalPath, 0o600)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
      return { provider: `arkme-bot-${resourceHash}`, source: 'file', id: 'value', providerPath: finalPath }
    },
  }
}
