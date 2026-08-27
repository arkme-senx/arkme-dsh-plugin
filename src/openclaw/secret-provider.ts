import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { OpenClawSecretStore } from './types.js'
import { securePrivateDirectory, securePrivateFile } from '../private-filesystem.js'

export function createOpenClawFileSecretStore(options: { rootDir: string }): OpenClawSecretStore {
  const restartMarker = (resourceHash: string) => join(options.rootDir, `${resourceHash}.restart-required`)
  const secretPath = (resourceHash: string) => join(options.rootDir, `${resourceHash}.secret`)
  const previewPath = (resourceHash: string) => join(options.rootDir, `${resourceHash}.preview`)
  return {
    async ensureOwnership({ resourceHash, localResourceExists }) {
      await mkdir(options.rootDir, { recursive: true, mode: 0o700 })
      await securePrivateDirectory(options.rootDir)
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
        await securePrivateFile(markerPath)
      }
    },
    async persist({ resourceHash, secret, tokenPreview }) {
      await mkdir(options.rootDir, { recursive: true, mode: 0o700 })
      await securePrivateDirectory(options.rootDir)
      const finalPath = secretPath(resourceHash)
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
        await securePrivateFile(finalPath)
        const previewTemporaryPath = join(options.rootDir, `.${resourceHash}.${randomUUID()}.preview.tmp`)
        try {
          const previewFile = await open(previewTemporaryPath, 'wx', 0o600)
          try { await previewFile.writeFile(tokenPreview.trim(), 'utf8'); await previewFile.sync() } finally { await previewFile.close() }
          await rename(previewTemporaryPath, previewPath(resourceHash))
          await securePrivateFile(previewPath(resourceHash))
        } catch (error) {
          await unlink(previewTemporaryPath).catch(() => undefined)
          throw error
        }
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
      return { provider: `arkme-bot-${resourceHash}`, source: 'file', id: 'value', providerPath: finalPath }
    },
    async matchesPreview(resourceHash, expectedPreview) {
      try {
        await readFile(secretPath(resourceHash), 'utf8')
        return (await readFile(previewPath(resourceHash), 'utf8')).trim() === expectedPreview.trim()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    },
    async isRestartRequired(resourceHash) {
      try { await readFile(restartMarker(resourceHash)); return true } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    },
    async markRestartRequired(resourceHash) {
      const file = await open(restartMarker(resourceHash), 'w', 0o600)
      try { await file.writeFile('1', 'utf8'); await file.sync() } finally { await file.close() }
      await securePrivateFile(restartMarker(resourceHash))
    },
    async clearRestartRequired(resourceHash) {
      await unlink(restartMarker(resourceHash)).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    },
  }
}
