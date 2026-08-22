import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { ARKME_PRODUCTION_TRUSTED_SIGNING_KEYS } from '../src/index.js'

describe('bundled plugin configuration', () => {
  it('routes every owner API to the Jotmo test environment', () => {
    const patch = YAML.parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as Array<{
      insert: Array<{ config: Record<string, unknown> }>
    }>
    const config = patch[0]?.insert[0]?.config

    expect(config).toMatchObject({
      environment: 'test',
      authBaseUrl: 'https://jotmo.senguo.me',
      subjectBaseUrl: 'https://jotmo-subject.senguo.me',
      recordBaseUrl: 'https://jotmo-record.senguo.me',
      chatBaseUrl: 'https://jotmo-chat.senguo.me',
      botBaseUrl: 'https://jotmo-bot.senguo.me',
      imBaseUrl: 'https://jotmo-im.senguo.me',
      webrtcBaseUrl: 'https://jotmo-webrtc.senguo.me',
      worldBaseUrl: 'https://jotmo-world.senguo.me',
      relationBaseUrl: 'https://jotmo-relation.senguo.me',
      intelligentBaseUrl: 'https://jotmo-intelligent.senguo.me',
      audioBaseUrl: 'https://jotmo-audio.senguo.me',
      extensionPublishBaseUrl: '',
      allowProduction: false,
    })
  })

  it('keeps the production signing key available for verifying published extensions', () => {
    expect(JSON.parse(ARKME_PRODUCTION_TRUSTED_SIGNING_KEYS)).toEqual({
      'prod-ed25519-20260819-1': 'm1MKKU16hyu1b1KKIXMG+zKEr/GmhmvyUEreJzthTxs=',
    })
  })
})
