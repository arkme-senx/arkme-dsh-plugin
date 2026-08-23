import { randomUUID } from 'node:crypto'
import { chmod, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ARKME_PLUGIN_PACKAGE_NAME } from './plugin-update-artifact.js'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'

export interface PluginUpdateInstallReceiptInput {
  targetVersion: string
  targetArtifactPath: string
  targetArtifactSha512?: string
  appVersion?: string
  dshVersion?: string
}

export async function writePluginUpdateInstallReceipt(
  input: PluginUpdateInstallReceiptInput,
): Promise<void> {
  if (input.targetArtifactSha512 === undefined || input.appVersion === undefined || input.dshVersion === undefined) {
    throw new Error('plugin update install receipt metadata is incomplete')
  }
  if (!/^[a-f0-9]{128}$/.test(input.targetArtifactSha512)) {
    throw new Error('plugin update install receipt digest is invalid')
  }
  const directory = dirname(input.targetArtifactPath)
  const receiptPath = join(directory, 'plugin-update-install-receipt.json')
  await securePrivateDirectory(directory)
  const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({
    schemaVersion: 1,
    packageName: ARKME_PLUGIN_PACKAGE_NAME,
    targetVersion: input.targetVersion,
    targetArtifactPath: input.targetArtifactPath,
    targetArtifactSha512: input.targetArtifactSha512,
    appVersion: input.appVersion,
    dshVersion: input.dshVersion,
    installedAtMillis: Date.now(),
  }, undefined, 2)}\n`, { mode: 0o600 })
  await chmod(temporaryPath, 0o600)
  try {
    await rename(temporaryPath, receiptPath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
  await securePrivateFile(receiptPath)
}
