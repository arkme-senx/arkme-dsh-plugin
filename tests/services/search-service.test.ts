import { describe, expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { SearchService } from '../../src/services/search-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('SearchService', () => {
  it('rejects an empty record query before reading owner data', async () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    await expect(service.searchRemote({ query: ' ', limit: 20 })).rejects.toMatchObject({
      code: 'record-query-empty',
    })
  })
})
