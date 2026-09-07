import { describe, expect, it } from 'vitest'
import { apply, Config as ConfigSchema, resolveArkmeConfig, type Config } from '../src/index.js'

function productionConfig(): Config {
  return ConfigSchema({
    environment: 'prod',
    authBaseUrl: 'https://api.jotmo.cc',
    subjectBaseUrl: 'https://subject.jotmo.cc',
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
    shareWebsite: 'https://jiwo.cc',
    allowProduction: true,
  })
}

describe('plugin environment validation', () => {
  it('fills a missing production data service origin before validation', () => {
    const config = { ...productionConfig(), dataBaseUrl: '' }

    expect(resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, config).dataBaseUrl)
      .toBe('https://data.jotmo.cc')
  })

  it('resolves the managed OpenAPI origin per environment and rejects test leakage in production', () => {
    const production = { ...productionConfig(), openApiBaseUrl: '' }
    expect(resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, production).openApiBaseUrl)
      .toBe('https://openapi.jotmo.cc')

    const test = { ...productionConfig(), environment: 'test' as const, openApiBaseUrl: '' }
    expect(resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, test).openApiBaseUrl)
      .toBe('https://jotmo-openapi.senguo.me')

    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, {
      ...productionConfig(), openApiBaseUrl: 'https://jotmo-openapi.senguo.me',
    })).toThrow(/production environment must explicitly configure every service origin/)
  })

  it('always requires the managed OpenAPI endpoint used by Team to be an HTTPS origin', () => {
    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, {
      ...productionConfig(), environment: 'test', openApiBaseUrl: 'http://127.0.0.1:8080/path',
    })).toThrow(/openApiBaseUrl must be an HTTPS origin/)

    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, {
      ...productionConfig(), environment: 'test', openApiBaseUrl: 'https://openapi.example.com?tenant=wrong',
    })).toThrow(/openApiBaseUrl must be an HTTPS origin/)

    expect(resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, {
      ...productionConfig(), environment: 'test', openApiBaseUrl: 'https://openapi.example.com/',
    }).openApiBaseUrl).toBe('https://openapi.example.com')

    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, {
      ...productionConfig(), environment: 'test', openApiMcpEnabled: false,
      openApiBaseUrl: 'http://127.0.0.1:8080/path',
    })).toThrow(/openApiBaseUrl must be an HTTPS origin/)
  })

  it('rejects a production Team endpoint that leaks test infrastructure even when MCP mounting is disabled', () => {
    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, {
      ...productionConfig(), openApiMcpEnabled: false,
      openApiBaseUrl: 'https://jotmo-openapi.senguo.me',
    })).toThrow(/production environment must explicitly configure every service origin/)
  })

  it('keeps a legacy omitted data service origin distinguishable after schema parsing', () => {
    const { dataBaseUrl: _omitted, ...legacyProfile } = productionConfig()
    const config = ConfigSchema(legacyProfile)

    expect(resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, config).dataBaseUrl)
      .toBe('https://data.jotmo.cc')
  })

  it('fills a missing test data service origin with test infrastructure', () => {
    const config = { ...productionConfig(), environment: 'test' as const, dataBaseUrl: '' }

    expect(resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, config).dataBaseUrl)
      .toBe('https://jotmo-data.senguo.me')
  })

  it('preserves an explicitly configured data service origin', () => {
    const config = { ...productionConfig(), dataBaseUrl: 'https://custom-data.example.com' }

    expect(resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, config).dataBaseUrl)
      .toBe('https://custom-data.example.com')
  })

  it('still rejects an explicitly configured test data service origin in production', () => {
    const config = { ...productionConfig(), dataBaseUrl: 'https://jotmo-data.senguo.me' }

    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, config))
      .toThrow(/production environment must explicitly configure every service origin/)
  })

  it('normalizes a legacy production profile through the plugin apply entrypoint', () => {
    const config = { ...productionConfig(), dataBaseUrl: '' }

    expect(() => apply({ webServer: { host: '0.0.0.0' } } as never, config))
      .toThrow(/Web UI must bind 127\.0\.0\.1/)
  })

  it('rejects a production profile that silently keeps a test service origin', () => {
    const config = { ...productionConfig(), intelligentBaseUrl: 'https://jotmo-intelligent.senguo.me' }

    expect(() => { apply({} as never, config) })
      .toThrow(/production environment must explicitly configure every service origin/)
  })

  it('requires an explicit credential-free Realtime origin only when DSH remote is enabled', () => {
    const enabled = { ...productionConfig(), environment: 'test' as const, dshRemoteFeatureEnabled: true }

    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, enabled))
      .toThrow(/requires dshRemoteRealtimeBaseUrl/)
    expect(() => resolveArkmeConfig({ webServer: { host: '127.0.0.1' } } as never, {
      ...enabled,
      dshRemoteRealtimeBaseUrl: 'https://jotmo-realtime.senguo.me',
    })).not.toThrow()
  })
})
