import { describe, expect, it } from 'vitest'
import { ArkmeWindowsCredentialStore, type ArkmeSessionCredentials } from '../src/keychain-store.js'

describe.skipIf(process.platform !== 'win32')('Windows Credential Locker integration', () => {
  it('round-trips and deletes an Arkme session through the native store', async () => {
    const service = `com.senqisi.dsh-arkme.integration.${process.pid}.${Date.now()}`
    const session: ArkmeSessionCredentials = {
      userId: 10001,
      accessToken: 'integration-access-token',
      refreshToken: 'integration-refresh-token',
    }

    try {
      const writer = new ArkmeWindowsCredentialStore(service)
      await writer.write(session)
      const reader = new ArkmeWindowsCredentialStore(service)
      await expect(reader.read()).resolves.toEqual(session)
      await reader.delete()
      const afterDelete = new ArkmeWindowsCredentialStore(service)
      await expect(afterDelete.read()).resolves.toBeUndefined()
    } finally {
      await new ArkmeWindowsCredentialStore(service).delete()
    }
  })
})
