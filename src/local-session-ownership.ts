import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { securePrivateDirectorySync, securePrivateFileSync } from './private-filesystem.js'

export interface LocalSessionOwner {
  sessionId: string
  conversationRef: string
  owner: string
  epoch: number
  phase: 'active' | 'releasing' | 'released'
  target: string | null
  transfer: string | null
}

export interface LocalSessionPeer {
  instance: string
  port: number
  token: string
}

/** Same-OS-user coordination metadata. DSH still owns the actual writer lock. */
export class LocalSessionOwnership {
  private readonly db: DatabaseSync

  constructor(root: string, scope: { environment: 'test' | 'prod'; accountId: string }) {
    if (!/^[1-9]\d{0,19}$/.test(scope.accountId) || !['test', 'prod'].includes(scope.environment)) {
      throw new Error('本机会话账号或环境无效')
    }
    mkdirSync(root, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(root)
    const path = join(root, 'ownership.sqlite')
    this.db = new DatabaseSync(path)
    try {
      securePrivateFileSync(path)
      // Only short metadata statements contend; never hold a SQLite transaction
      // while waiting for IPC, a model, or DSH disposal.
      this.db.exec(`PRAGMA busy_timeout = 100;
        CREATE TABLE IF NOT EXISTS scope (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), environment TEXT NOT NULL, account TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS owners (
          sessionId TEXT PRIMARY KEY, conversationRef TEXT NOT NULL UNIQUE,
          owner TEXT NOT NULL, epoch INTEGER NOT NULL, phase TEXT NOT NULL,
          target TEXT, transfer TEXT
        );
        CREATE TABLE IF NOT EXISTS addresses (sessionId TEXT PRIMARY KEY, runtimeRef TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS peers (instance TEXT PRIMARY KEY, port INTEGER NOT NULL, token TEXT NOT NULL);`)
      this.db.prepare('INSERT OR IGNORE INTO scope VALUES (1, ?, ?)').run(scope.environment, scope.accountId)
      const saved = this.db.prepare('SELECT environment, account FROM scope WHERE singleton = 1').get()!
      if (saved.environment !== scope.environment || saved.account !== scope.accountId) throw new Error('共享会话目录属于其他账号或环境')
    } catch (error) { this.db.close(); throw error }
  }

  close(): void { this.db.close() }

  assertScope(scope: { environment: 'test' | 'prod'; accountId: string }): void {
    const current = this.db.prepare('SELECT environment, account FROM scope WHERE singleton = 1').get()
    if (current?.environment !== scope.environment || current.account !== scope.accountId) throw new Error('共享会话目录属于其他账号或环境')
  }

  publishPeer(peer: LocalSessionPeer): void {
    this.validateRef(peer.instance)
    if (!Number.isInteger(peer.port) || peer.port < 1 || peer.port > 65535 || !/^[a-f0-9]{64}$/.test(peer.token)) throw new Error('本机实例地址无效')
    // Refuse rather than evict discovery for a possibly live writer. Normal
    // shutdown removes the row; crash recovery may retire the exact old peer.
    const inserted = this.db.prepare('INSERT INTO peers SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM peers) < 256')
      .run(peer.instance, peer.port, peer.token)
    if (Number(inserted.changes) !== 1) throw new Error('本机实例记录已达上限，需要清理已确认退出的实例')
  }

  peer(instance: string): LocalSessionPeer | undefined {
    this.validateRef(instance)
    return this.db.prepare('SELECT * FROM peers WHERE instance = ?').get(instance) as unknown as LocalSessionPeer | undefined
  }

  /** Discovery is bounded by publishPeer; the authenticated IPC confirms liveness. */
  observationPeers(): { owner: string; signature: string }[] {
    return this.db.prepare(`SELECT owner, group_concat(sessionId || ':' || epoch) AS signature
      FROM owners WHERE phase = 'active' AND owner IN (SELECT instance FROM peers)
      GROUP BY owner ORDER BY owner`).all() as unknown as { owner: string; signature: string }[]
  }

  removePeer(peer: LocalSessionPeer): void {
    this.db.prepare('DELETE FROM peers WHERE instance = ? AND token = ?').run(peer.instance, peer.token)
  }

  read(sessionId: string): LocalSessionOwner | undefined {
    this.validateRef(sessionId)
    return this.db.prepare('SELECT * FROM owners WHERE sessionId = ?').get(sessionId) as unknown as LocalSessionOwner | undefined
  }

  /** Bind the first published address once. A handoff changes no history key. */
  bindAddress(sessionId: string, runtimeRef: string): string {
    this.validateRef(sessionId); this.validateRef(runtimeRef)
    this.db.prepare('INSERT OR IGNORE INTO addresses VALUES (?, ?)').run(sessionId, runtimeRef)
    return this.address(sessionId)!
  }

  address(sessionId: string): string | undefined {
    this.validateRef(sessionId)
    return this.db.prepare('SELECT runtimeRef FROM addresses WHERE sessionId = ?').get(sessionId)?.runtimeRef as string | undefined
  }

  /** Called only after obtaining the corresponding DSH writer. */
  register(sessionId: string, owner: string): LocalSessionOwner {
    this.validateRef(sessionId); this.validateRef(owner)
    this.db.prepare(`INSERT OR IGNORE INTO owners VALUES (?, ?, ?, 1, 'active', NULL, NULL)`)
      .run(sessionId, randomUUID(), owner)
    const current = this.read(sessionId)!
    if (current.owner !== owner || current.phase !== 'active') throw new Error('会话执行权已改变')
    return current
  }

  prepare(expected: LocalSessionOwner, target: string): LocalSessionOwner {
    this.validateRef(target)
    if (target === expected.owner) throw new Error('不能交接给当前执行者')
    const transfer = randomUUID()
    const changed = this.db.prepare(`UPDATE owners SET phase = 'releasing', target = ?, transfer = ?
      WHERE sessionId = ? AND owner = ? AND epoch = ? AND phase = 'active'`)
      .run(target, transfer, expected.sessionId, expected.owner, expected.epoch)
    this.requireChange(changed.changes)
    return this.read(expected.sessionId)!
  }

  /** A successful, fully drained handle disposal is the release acknowledgement. */
  released(prepared: LocalSessionOwner): LocalSessionOwner {
    this.transition(prepared, 'released')
    return this.read(prepared.sessionId)!
  }

  /** Revert only while the old lifecycle is still known to be live and intact. */
  cancel(prepared: LocalSessionOwner): void { this.transition(prepared, 'active') }

  private transition(expected: LocalSessionOwner, phase: 'active' | 'released'): void {
    const changed = this.db.prepare(`UPDATE owners SET phase = ?,
      target = CASE WHEN ? = 'active' THEN NULL ELSE target END,
      transfer = CASE WHEN ? = 'active' THEN NULL ELSE transfer END
      WHERE sessionId = ? AND owner = ? AND epoch = ? AND phase = 'releasing' AND transfer = ?`)
      .run(phase, phase, phase, expected.sessionId, expected.owner, expected.epoch, expected.transfer)
    this.requireChange(changed.changes)
  }

  /** Commit only after resume has obtained the DSH writer and completed setup. */
  acquired(released: LocalSessionOwner, target: string): LocalSessionOwner {
    if (released.target !== target || !released.transfer) throw new Error('交接目标不匹配')
    const changed = this.db.prepare(`UPDATE owners SET owner = ?, epoch = epoch + 1, phase = 'active', target = NULL, transfer = NULL
      WHERE sessionId = ? AND owner = ? AND epoch = ? AND epoch < 9007199254740991 AND phase = 'released' AND target = ? AND transfer = ?`)
      .run(target, released.sessionId, released.owner, released.epoch, target, released.transfer)
    this.requireChange(changed.changes)
    return this.read(released.sessionId)!
  }

  /** Crash recovery: possession of a DSH writer is mandatory, never a timer alone. */
  recovered(expected: LocalSessionOwner, target: string): LocalSessionOwner {
    this.validateRef(target)
    const changed = this.db.prepare(`UPDATE owners SET owner = ?, epoch = epoch + 1, phase = 'active', target = NULL, transfer = NULL
      WHERE sessionId = ? AND owner = ? AND epoch = ? AND epoch < 9007199254740991 AND phase = ? AND transfer IS ?`)
      .run(target, expected.sessionId, expected.owner, expected.epoch, expected.phase, expected.transfer)
    this.requireChange(changed.changes)
    return this.read(expected.sessionId)!
  }

  private validateRef(value: string): void {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('本机会话引用无效')
  }

  private requireChange(changes: number | bigint): void {
    if (Number(changes) !== 1) throw new Error('会话执行权已改变，请重新读取')
  }
}
