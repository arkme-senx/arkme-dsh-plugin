export const ARKME_CONFIG_CONTRACT_VERSION = 2 as const

export const ARKME_PRODUCTION_ORIGIN_PRESET = {
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
  extensionPublishBaseUrl: 'https://extension-publish.jotmo.cc',
  updateServiceBaseUrl: 'https://api.jotmo.cc',
  updateArtifactBaseUrl: 'https://d.jiwo.cc',
  shareWebsite: 'https://jiwo.cc',
} as const

export type ArkmeManagedOriginKey = keyof typeof ARKME_PRODUCTION_ORIGIN_PRESET
export type ArkmeManagedOriginConfig = Record<ArkmeManagedOriginKey, string>

export const ARKME_MANAGED_ORIGIN_KEYS = Object.freeze(
  Object.keys(ARKME_PRODUCTION_ORIGIN_PRESET) as ArkmeManagedOriginKey[],
)

type ArkmeVersionedConfig = {
  environment: 'prod'
  configContractVersion?: number
} & Partial<ArkmeManagedOriginConfig>

export type ResolvedArkmeConfig<T extends ArkmeVersionedConfig> =
  Omit<T, ArkmeManagedOriginKey | 'configContractVersion'>
  & ArkmeManagedOriginConfig
  & { configContractVersion: typeof ARKME_CONFIG_CONTRACT_VERSION }

function migrateV1ToV2<T extends ArkmeVersionedConfig>(config: T): ArkmeVersionedConfig {
  return { ...config, configContractVersion: 2 }
}

const ARKME_CONFIG_MIGRATIONS: Readonly<Record<number, (config: ArkmeVersionedConfig) => ArkmeVersionedConfig>> = {
  1: migrateV1ToV2,
}

export function resolveArkmeConfig<T extends ArkmeVersionedConfig>(rawConfig: T): ResolvedArkmeConfig<T> {
  const declaredVersion = rawConfig.configContractVersion ?? 1
  if (!Number.isInteger(declaredVersion) || declaredVersion < 1) {
    throw new Error('dsh-arkme: configContractVersion must be a positive integer')
  }
  if (declaredVersion > ARKME_CONFIG_CONTRACT_VERSION) {
    throw new Error(
      `dsh-arkme: config contract ${String(declaredVersion)} requires a newer Arkme plugin (supported: ${String(ARKME_CONFIG_CONTRACT_VERSION)})`,
    )
  }
  if (declaredVersion >= 2 && ARKME_MANAGED_ORIGIN_KEYS.some(key => rawConfig[key] !== undefined)) {
    throw new Error('dsh-arkme: service origins are production-owned and cannot be overridden')
  }

  let migrated: ArkmeVersionedConfig = { ...rawConfig, configContractVersion: declaredVersion }
  while ((migrated.configContractVersion ?? 1) < ARKME_CONFIG_CONTRACT_VERSION) {
    const version = migrated.configContractVersion ?? 1
    const migration = ARKME_CONFIG_MIGRATIONS[version]
    if (migration === undefined) {
      throw new Error(`dsh-arkme: no config migration is available from contract ${String(version)}`)
    }
    migrated = migration(migrated)
  }

  return {
    ...migrated,
    ...ARKME_PRODUCTION_ORIGIN_PRESET,
    configContractVersion: ARKME_CONFIG_CONTRACT_VERSION,
  } as ResolvedArkmeConfig<T>
}
