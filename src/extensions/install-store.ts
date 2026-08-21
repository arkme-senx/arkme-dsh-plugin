import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ArkmeExtensionManifest, ArkmeInstalledExtension, ArkmeNativeCapability } from './types.js'

interface ExtensionRow {
  extension_id: string
  installed_version: string
  artifact_sha256: string
  artifact_path: string
  manifest_json: string
  enabled: number
  active: number
  dynamic_plugin_id: string | null
  dynamic_package_id: string | null
  profile_package_name: string | null
  profile_bundle_path: string | null
  execution_model: 'arkme-sandboxed' | 'dsh-native' | null
  artifact_contract_version: 2 | 3 | null
  native_capabilities_json: string
  package_json_sha256: string | null
  source_sha256: string | null
  permission_snapshot_json: string
  update_channel: 'stable' | 'beta'
  installed_at_millis: number
  last_checked_at_millis: number
  last_error: string | null
}

export class ArkmeExtensionInstallStore {
  private readonly path: string
  private readonly database: DatabaseSync

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    this.path = join(directory, 'extensions.sqlite3')
    this.database = new DatabaseSync(this.path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS installed_extensions (
        extension_id TEXT PRIMARY KEY,
        installed_version TEXT NOT NULL,
        artifact_sha256 TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 0,
        dynamic_plugin_id TEXT,
        dynamic_package_id TEXT,
        profile_package_name TEXT,
        profile_bundle_path TEXT,
        execution_model TEXT,
        artifact_contract_version INTEGER,
        native_capabilities_json TEXT NOT NULL DEFAULT '[]',
        package_json_sha256 TEXT,
        source_sha256 TEXT,
        permission_snapshot_json TEXT NOT NULL DEFAULT '[]',
        update_channel TEXT NOT NULL DEFAULT 'stable' CHECK (update_channel IN ('stable', 'beta')),
        installed_at_millis INTEGER NOT NULL,
        last_checked_at_millis INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS extension_install_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    const columns = new Set((this.database.prepare('PRAGMA table_info(installed_extensions)').all() as Array<{ name: string }>)
      .map(column => column.name))
    if (!columns.has('profile_package_name')) this.database.exec('ALTER TABLE installed_extensions ADD COLUMN profile_package_name TEXT')
    if (!columns.has('profile_bundle_path')) this.database.exec('ALTER TABLE installed_extensions ADD COLUMN profile_bundle_path TEXT')
    if (!columns.has('execution_model')) this.database.exec('ALTER TABLE installed_extensions ADD COLUMN execution_model TEXT')
    if (!columns.has('artifact_contract_version')) this.database.exec('ALTER TABLE installed_extensions ADD COLUMN artifact_contract_version INTEGER')
    if (!columns.has('native_capabilities_json')) this.database.exec("ALTER TABLE installed_extensions ADD COLUMN native_capabilities_json TEXT NOT NULL DEFAULT '[]'")
    if (!columns.has('package_json_sha256')) this.database.exec('ALTER TABLE installed_extensions ADD COLUMN package_json_sha256 TEXT')
    if (!columns.has('source_sha256')) this.database.exec('ALTER TABLE installed_extensions ADD COLUMN source_sha256 TEXT')
    // Dynamic Cordis runs are process-owned. Never restore a stale active claim after DSH restarts.
    this.database.exec('UPDATE installed_extensions SET active = 0, dynamic_plugin_id = NULL, dynamic_package_id = NULL')
    this.secureFiles()
  }

  installationInstanceId(): string {
    const key = 'installation_instance_id'
    const existing = this.database.prepare('SELECT value FROM extension_install_metadata WHERE key = ?')
      .get(key) as { value: string } | undefined
    if (existing?.value.trim()) return existing.value
    const candidate = randomUUID()
    this.database.prepare('INSERT OR IGNORE INTO extension_install_metadata (key, value) VALUES (?, ?)')
      .run(key, candidate)
    const persisted = this.database.prepare('SELECT value FROM extension_install_metadata WHERE key = ?')
      .get(key) as { value: string } | undefined
    if (persisted === undefined || persisted.value.trim() === '') {
      throw new Error('failed to persist extension installation instance identity')
    }
    this.secureFiles()
    return persisted.value
  }

  list(): ArkmeInstalledExtension[] {
    const rows = this.database.prepare(`
      SELECT extension_id, installed_version, artifact_sha256, artifact_path, manifest_json,
             enabled, active, dynamic_plugin_id, dynamic_package_id, profile_package_name, profile_bundle_path,
             execution_model, artifact_contract_version, native_capabilities_json,
             package_json_sha256, source_sha256, permission_snapshot_json,
             update_channel, installed_at_millis, last_checked_at_millis, last_error
      FROM installed_extensions ORDER BY installed_at_millis DESC, extension_id ASC
    `).all() as unknown as ExtensionRow[]
    return rows.map(row => this.fromRow(row))
  }

  get(extensionId: string): ArkmeInstalledExtension | undefined {
    const row = this.database.prepare(`
      SELECT extension_id, installed_version, artifact_sha256, artifact_path, manifest_json,
             enabled, active, dynamic_plugin_id, dynamic_package_id, profile_package_name, profile_bundle_path,
             execution_model, artifact_contract_version, native_capabilities_json,
             package_json_sha256, source_sha256, permission_snapshot_json,
             update_channel, installed_at_millis, last_checked_at_millis, last_error
      FROM installed_extensions WHERE extension_id = ?
    `).get(extensionId) as unknown as ExtensionRow | undefined
    return row === undefined ? undefined : this.fromRow(row)
  }

  put(item: ArkmeInstalledExtension): void {
    this.database.prepare(`
      INSERT INTO installed_extensions (
        extension_id, installed_version, artifact_sha256, artifact_path, manifest_json,
        enabled, active, dynamic_plugin_id, dynamic_package_id, profile_package_name, profile_bundle_path,
        execution_model, artifact_contract_version, native_capabilities_json, package_json_sha256, source_sha256,
        permission_snapshot_json, update_channel, installed_at_millis, last_checked_at_millis, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(extension_id) DO UPDATE SET
        installed_version = excluded.installed_version,
        artifact_sha256 = excluded.artifact_sha256,
        artifact_path = excluded.artifact_path,
        manifest_json = excluded.manifest_json,
        enabled = excluded.enabled,
        active = excluded.active,
        dynamic_plugin_id = excluded.dynamic_plugin_id,
        dynamic_package_id = excluded.dynamic_package_id,
        profile_package_name = excluded.profile_package_name,
        profile_bundle_path = excluded.profile_bundle_path,
        execution_model = excluded.execution_model,
        artifact_contract_version = excluded.artifact_contract_version,
        native_capabilities_json = excluded.native_capabilities_json,
        package_json_sha256 = excluded.package_json_sha256,
        source_sha256 = excluded.source_sha256,
        permission_snapshot_json = excluded.permission_snapshot_json,
        update_channel = excluded.update_channel,
        installed_at_millis = excluded.installed_at_millis,
        last_checked_at_millis = excluded.last_checked_at_millis,
        last_error = excluded.last_error
    `).run(
      item.extensionId, item.installedVersion, item.artifactSha256, item.artifactPath,
      JSON.stringify(item.manifest), item.enabled ? 1 : 0, item.active ? 1 : 0,
      item.dynamicPluginId ?? null, item.dynamicPackageId ?? null,
      item.profilePackageName ?? null, item.profileBundlePath ?? null,
      item.executionModel ?? null, item.artifactContractVersion ?? null, JSON.stringify(item.nativeCapabilities ?? []),
      item.packageJsonSha256 ?? null, item.sourceSha256 ?? null,
      JSON.stringify(item.permissionSnapshot), item.updateChannel, item.installedAtMillis,
      item.lastCheckedAtMillis, item.lastError ?? null,
    )
    this.secureFiles()
  }

  remove(extensionId: string): void {
    this.database.prepare('DELETE FROM installed_extensions WHERE extension_id = ?').run(extensionId)
    this.secureFiles()
  }

  markChecked(extensionIds: readonly string[], checkedAtMillis = Date.now()): void {
    const update = this.database.prepare('UPDATE installed_extensions SET last_checked_at_millis = ? WHERE extension_id = ?')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const extensionId of extensionIds) update.run(checkedAtMillis, extensionId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.secureFiles()
  }

  close(): void {
    this.database.close()
  }

  private fromRow(row: ExtensionRow): ArkmeInstalledExtension {
    const manifest = JSON.parse(row.manifest_json) as ArkmeExtensionManifest
    const permissionSnapshot = JSON.parse(row.permission_snapshot_json) as unknown
    const nativeCapabilities = JSON.parse(row.native_capabilities_json) as unknown
    return {
      extensionId: row.extension_id,
      installedVersion: row.installed_version,
      artifactSha256: row.artifact_sha256,
      artifactPath: row.artifact_path,
      manifest,
      enabled: row.enabled === 1,
      active: row.active === 1,
      ...(row.dynamic_plugin_id === null ? {} : { dynamicPluginId: row.dynamic_plugin_id }),
      ...(row.dynamic_package_id === null ? {} : { dynamicPackageId: row.dynamic_package_id }),
      ...(row.profile_package_name === null ? {} : { profilePackageName: row.profile_package_name }),
      ...(row.profile_bundle_path === null ? {} : { profileBundlePath: row.profile_bundle_path }),
      ...(row.execution_model === null ? {} : { executionModel: row.execution_model }),
      ...(row.artifact_contract_version === null ? {} : { artifactContractVersion: row.artifact_contract_version }),
      nativeCapabilities: Array.isArray(nativeCapabilities)
        ? nativeCapabilities.filter((value): value is ArkmeNativeCapability => typeof value === 'string')
        : [],
      ...(row.package_json_sha256 === null ? {} : { packageJsonSha256: row.package_json_sha256 }),
      ...(row.source_sha256 === null ? {} : { sourceSha256: row.source_sha256 }),
      permissionSnapshot: Array.isArray(permissionSnapshot)
        ? permissionSnapshot.filter((value): value is string => typeof value === 'string')
        : [],
      updateChannel: row.update_channel,
      installedAtMillis: row.installed_at_millis,
      lastCheckedAtMillis: row.last_checked_at_millis,
      ...(row.last_error === null ? {} : { lastError: row.last_error }),
    }
  }

  private secureFiles(): void {
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      try { chmodSync(path, 0o600) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
