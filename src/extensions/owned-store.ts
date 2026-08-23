import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { securePrivateDirectorySync, securePrivateFileSync } from '../private-filesystem.js'

export type ArkmeOwnedExtensionSourceKind = 'cordis' | 'profile'

export interface ArkmeOwnedExtensionSourceReference {
  kind: ArkmeOwnedExtensionSourceKind
  key: string
}

interface OwnedSourceRow {
  owner_user_id: number
  spec_digest: string | null
  cloud_extension_id: string | null
}

/** Account ownership and explicit cloud lineage for local extension sources. */
export class ArkmeOwnedExtensionStore {
  private readonly path: string
  private readonly database: DatabaseSync
  private readonly securedWindowsFiles = new Set<string>()

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(directory)
    this.path = join(directory, 'owned-extensions.sqlite3')
    this.database = new DatabaseSync(this.path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS owned_extension_sources (
        source_kind TEXT NOT NULL CHECK (source_kind IN ('cordis', 'profile')),
        source_key TEXT NOT NULL,
        owner_user_id INTEGER NOT NULL,
        spec_digest TEXT,
        cloud_extension_id TEXT,
        claimed_at_millis INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL,
        PRIMARY KEY (source_kind, source_key)
      );
    `)
    this.secureFiles()
  }

  claim(kind: ArkmeOwnedExtensionSourceKind, key: string, userId: number, specDigest?: string): void {
    this.assertIdentity(kind, key, userId)
    if (specDigest !== undefined && !/^[a-f0-9]{64}$/.test(specDigest)) throw new Error('扩展来源摘要无效')
    const now = Date.now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.row(kind, key)
      if (existing !== undefined && existing.owner_user_id !== userId) throw new Error('扩展已属于其他 Arkme 账号')
      this.database.prepare(`
        INSERT INTO owned_extension_sources (
          source_kind, source_key, owner_user_id, spec_digest, claimed_at_millis, updated_at_millis
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_kind, source_key) DO UPDATE SET
          spec_digest = COALESCE(excluded.spec_digest, owned_extension_sources.spec_digest),
          updated_at_millis = excluded.updated_at_millis
      `).run(kind, key, userId, specDigest ?? null, now, now)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.secureFiles()
  }

  linkCloud(kind: ArkmeOwnedExtensionSourceKind, key: string, userId: number, extensionId: string): void {
    this.assertIdentity(kind, key, userId)
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(extensionId)) throw new Error('云端扩展身份无效')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.row(kind, key)
      if (existing === undefined) throw new Error('扩展来源尚未绑定账号')
      if (existing.owner_user_id !== userId) throw new Error('扩展已属于其他 Arkme 账号')
      this.database.prepare(`
        UPDATE owned_extension_sources
        SET cloud_extension_id = ?, updated_at_millis = ?
        WHERE source_kind = ? AND source_key = ?
      `).run(extensionId, Date.now(), kind, key)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.secureFiles()
  }

  owner(kind: ArkmeOwnedExtensionSourceKind, key: string): number | undefined {
    return this.row(kind, key)?.owner_user_id
  }

  specDigest(kind: ArkmeOwnedExtensionSourceKind, key: string): string | undefined {
    return this.row(kind, key)?.spec_digest ?? undefined
  }

  cloudLink(kind: ArkmeOwnedExtensionSourceKind, key: string, userId: number): string | undefined {
    const row = this.row(kind, key)
    return row?.owner_user_id === userId ? row.cloud_extension_id ?? undefined : undefined
  }

  cloudReferences(userId: number, extensionId: string): ArkmeOwnedExtensionSourceReference[] {
    this.assertCloudIdentity(userId, extensionId)
    const rows = this.database.prepare(`
      SELECT source_kind, hex(source_key) AS source_key_hex
      FROM owned_extension_sources
      WHERE owner_user_id = ? AND cloud_extension_id = ?
      ORDER BY source_kind ASC, source_key ASC
    `).all(userId, extensionId) as unknown as Array<{ source_kind: ArkmeOwnedExtensionSourceKind; source_key_hex: string }>
    return rows.map(row => ({ kind: row.source_kind, key: sqliteHexText(row.source_key_hex) }))
  }

  /** Delete local ownership/lineage references only for the authenticated owner and exact cloud identity. */
  removeCloudReferences(userId: number, extensionId: string): ArkmeOwnedExtensionSourceReference[] {
    const references = this.cloudReferences(userId, extensionId)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        DELETE FROM owned_extension_sources
        WHERE owner_user_id = ? AND cloud_extension_id = ?
      `).run(userId, extensionId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.secureFiles()
    return references
  }

  close(): void {
    this.database.close()
  }

  private row(kind: ArkmeOwnedExtensionSourceKind, key: string): OwnedSourceRow | undefined {
    return this.database.prepare(`
      SELECT owner_user_id, spec_digest, cloud_extension_id
      FROM owned_extension_sources WHERE source_kind = ? AND source_key = ?
    `).get(kind, key) as unknown as OwnedSourceRow | undefined
  }

  private assertIdentity(kind: ArkmeOwnedExtensionSourceKind, key: string, userId: number): void {
    if (!['cordis', 'profile'].includes(kind) || key === '' || key.length > 512) throw new Error('扩展来源身份无效')
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Arkme 账号身份无效')
  }

  private assertCloudIdentity(userId: number, extensionId: string): void {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Arkme 账号身份无效')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(extensionId)) throw new Error('云端扩展身份无效')
  }

  private secureFiles(): void {
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      if (process.platform === 'win32' && this.securedWindowsFiles.has(path)) continue
      try {
        securePrivateFileSync(path)
        if (process.platform === 'win32') this.securedWindowsFiles.add(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}

function sqliteHexText(value: string): string {
  if (!/^(?:[0-9A-F]{2})*$/.test(value)) throw new Error('扩展来源身份无效')
  return Buffer.from(value, 'hex').toString('utf8')
}
