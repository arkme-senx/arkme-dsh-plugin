import { describe, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.js'

function productionConfig(): Config {
  return {
    environment: 'prod',
    authBaseUrl: 'https://api.jotmo.cc',
    recordBaseUrl: 'https://record.jotmo.cc',
    dataBaseUrl: 'https://data.jotmo.cc',
    chatBaseUrl: 'https://chat.jotmo.cc',
    botBaseUrl: 'https://bot.jotmo.cc',
    imBaseUrl: 'https://im.jotmo.cc',
    webrtcBaseUrl: 'https://webrtc.jiwo.cc',
    worldBaseUrl: 'https://world.jotmo.cc',
    relationBaseUrl: 'https://relation.jotmo.cc',
    intelligentBaseUrl: 'https://intelligent.jotmo.cc',
    audioBaseUrl: 'https://audio.jotmo.cc',
    routePath: '/arkme-self/api',
    requestTimeoutMs: 30_000,
    maxTextLength: 20_000,
    toolProfile: 'business',
    geetestCaptchaId: 'ec81315ab8b0f18a7bfa13602d01e307',
    stateDirectory: '',
    keychainServicePrefix: 'com.senqisi.dsh-arkme',
    allowNonLoopback: false,
    allowProduction: true,
  }
}

describe('plugin environment validation', () => {
  it('rejects a production profile that silently keeps a test service origin', () => {
    const config = { ...productionConfig(), intelligentBaseUrl: 'https://jotmo-intelligent.senguo.me' }

    expect(() => { apply({} as never, config) })
      .toThrow(/production environment must explicitly configure every service origin/)
  })
})
