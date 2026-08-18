import { describe, expect, it } from 'vitest'
import * as jotmoPlugin from '../src/index.js'

type JotmoConfigValidator = (config: Record<string, unknown>, webServerHost: string) => void

const config = {
  environment: 'test',
  authBaseUrl: 'https://jotmo.senguo.me',
  recordBaseUrl: 'https://jotmo-record.senguo.me',
  chatBaseUrl: 'https://jotmo-chat.senguo.me',
  dataBaseUrl: 'https://jotmo-data.senguo.me',
  webrtcBaseUrl: 'https://jotmo-webrtc.senguo.me',
  routePath: '/jotmo-self/api',
  requestTimeoutMs: 30_000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'ec81315ab8b0f18a7bfa13602d01e307',
  stateDirectory: '',
  keychainServicePrefix: 'com.senqisi.dsh-jotmo',
  allowNonLoopback: false,
  allowProduction: false,
} satisfies Record<string, unknown>

function validator(): JotmoConfigValidator | undefined {
  return (jotmoPlugin as unknown as { validateJotmoConfig?: JotmoConfigValidator }).validateJotmoConfig
}

describe('Jotmo plugin configuration', () => {
  it('exposes the runtime validator used by plugin startup', () => {
    expect(validator()).toBeTypeOf('function')
  })

  it.each([
    ['dataBaseUrl', 'http://jotmo-data.senguo.me'],
    ['dataBaseUrl', 'https://user:secret@jotmo-data.senguo.me'],
    ['dataBaseUrl', 'https://jotmo-data.senguo.me/api'],
    ['webrtcBaseUrl', 'http://jotmo-webrtc.senguo.me'],
    ['webrtcBaseUrl', 'https://user:secret@jotmo-webrtc.senguo.me'],
    ['webrtcBaseUrl', 'https://jotmo-webrtc.senguo.me/api'],
  ])('rejects an unsafe %s origin', (field, value) => {
    const validate = validator()
    expect(validate).toBeTypeOf('function')
    if (validate === undefined) return
    expect(() => validate({ ...config, [field]: value }, '127.0.0.1'))
      .toThrow(new RegExp(field))
  })

  it('requires an explicit production opt-in and accepts explicit production origins', () => {
    const validate = validator()
    expect(validate).toBeTypeOf('function')
    if (validate === undefined) return
    const production = {
      ...config,
      environment: 'prod',
      dataBaseUrl: 'https://data.jotmo.cc',
      webrtcBaseUrl: 'https://webrtc.jiwo.cc',
    }
    expect(() => validate(production, '127.0.0.1')).toThrow(/allowProduction/)
    expect(() => validate({ ...production, allowProduction: true }, '127.0.0.1')).not.toThrow()
  })
})
