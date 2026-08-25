import { describe, expect, it } from 'vitest'
import { Config as ArkmeConfig } from '../src/index.js'
import {
  ARKME_CONFIG_CONTRACT_VERSION,
  ARKME_MANAGED_ORIGIN_KEYS,
  ARKME_PRODUCTION_ORIGIN_PRESET,
  resolveArkmeConfig,
} from '../src/config-compat.js'

describe('plugin production configuration', () => {
  it('accepts only the production environment and owns every service origin', () => {
    const raw = ArkmeConfig({
      configContractVersion: ARKME_CONFIG_CONTRACT_VERSION,
      environment: 'prod',
      allowProduction: true,
    })

    for (const key of ARKME_MANAGED_ORIGIN_KEYS) expect(raw).not.toHaveProperty(key)
    expect(resolveArkmeConfig(raw)).toMatchObject({
      configContractVersion: ARKME_CONFIG_CONTRACT_VERSION,
      ...ARKME_PRODUCTION_ORIGIN_PRESET,
    })
    expect(() => ArkmeConfig({ environment: 'test' as never })).toThrow(/expected prod/)
  })

  it('migrates an App 0.1.17-shaped V1 layer and supplies origins introduced later', () => {
    const legacy = ArkmeConfig({
      environment: 'prod',
      allowProduction: true,
      authBaseUrl: 'https://api.jotmo.cc',
      subjectBaseUrl: 'https://subject.jotmo.cc',
      recordBaseUrl: 'https://record.jotmo.cc',
      chatBaseUrl: 'https://chat.jotmo.cc',
      botBaseUrl: 'https://bot.jotmo.cc',
      imBaseUrl: 'https://im.jotmo.cc',
      webrtcBaseUrl: 'https://webrtc.jiwo.cc',
      worldBaseUrl: 'https://world.jotmo.cc',
      relationBaseUrl: 'https://relation.jotmo.cc',
      intelligentBaseUrl: 'https://intelligent.jotmo.cc',
      audioBaseUrl: 'https://audio.jotmo.cc',
      extensionPublishBaseUrl: 'https://extension-publish.jotmo.cc',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://d.jiwo.cc',
      shareWebsite: 'https://jiwo.cc',
    })

    expect(legacy.configContractVersion).toBe(1)
    expect(legacy).not.toHaveProperty('dataBaseUrl')
    expect(resolveArkmeConfig(legacy)).toMatchObject({
      configContractVersion: ARKME_CONFIG_CONTRACT_VERSION,
      ...ARKME_PRODUCTION_ORIGIN_PRESET,
    })
  })

  it('overwrites legacy origins and rejects V2 origin overrides', () => {
    expect(resolveArkmeConfig({
      environment: 'prod',
      authBaseUrl: ARKME_PRODUCTION_ORIGIN_PRESET.subjectBaseUrl,
    }).authBaseUrl).toBe(ARKME_PRODUCTION_ORIGIN_PRESET.authBaseUrl)

    expect(() => resolveArkmeConfig({
      configContractVersion: ARKME_CONFIG_CONTRACT_VERSION,
      environment: 'prod',
      authBaseUrl: ARKME_PRODUCTION_ORIGIN_PRESET.subjectBaseUrl,
    })).toThrow(/production-owned and cannot be overridden/)
  })

  it('rejects unsupported future config contracts', () => {
    expect(() => resolveArkmeConfig({
      configContractVersion: ARKME_CONFIG_CONTRACT_VERSION + 1,
      environment: 'prod',
    })).toThrow(/requires a newer Arkme plugin/)
  })
})
