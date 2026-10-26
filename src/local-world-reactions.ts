import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ReactionExpression, ReactionLibrary, ReactionLibraryResult, ReactionSetResult, ReactionState } from './reaction-contract.js'
import { arkmeDefaultEmojiSeeds } from './arkme-emoji-text.js'

const emojiIds = new Set(arkmeDefaultEmojiSeeds.map(emoji => emoji.id))
const colors = new Set(['peach', 'purple', 'rose', 'mint', 'blue', 'gold', 'cyan', 'mauve'])
const hands = new Set(['ok_hand', 'thumb_up', 'thanks_hands', 'fist', 'handshake', 'thumb_down', 'victory_hand', 'fist_salute'])
export function localReactionExpression(raw: unknown): ReactionExpression {
  const value = raw as ReactionExpression
  if (!value || typeof value.text !== 'string' || value.text.trim() !== value.text || Array.from(value.text).length > 20
    || !value.text && !value.emoji || value.emoji !== undefined && !emojiIds.has(value.emoji)
    || value.hand !== undefined && (!value.emoji || !hands.has(value.hand)) || value.color !== undefined && !colors.has(value.color)) throw new Error('表态内容无效')
  return { text: value.text, ...(value.emoji ? { emoji: value.emoji } : {}), ...(value.hand ? { hand: value.hand } : {}), ...(value.color ? { color: value.color } : {}) }
}
export function localReactionKey(expression: ReactionExpression) { return createHash('sha256').update(JSON.stringify(localReactionExpression(expression))).digest('hex') }
function validRevision(value: number) { return Number.isSafeInteger(value) && value >= 0 }

/** Durable private facts, never an outbox. Cloud migration requires a separate explicit action. */
export class LocalWorldReactions {
  constructor(private readonly db: DatabaseSync, private readonly transaction: (work: () => void) => void) {
    db.exec(`CREATE TABLE IF NOT EXISTS local_world_reactions (scope TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,target));
      CREATE TABLE IF NOT EXISTS local_world_reaction_receipts (scope TEXT NOT NULL, target TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL, PRIMARY KEY(scope,target,request_id));
      CREATE TABLE IF NOT EXISTS local_world_reaction_library (scope TEXT PRIMARY KEY, payload TEXT NOT NULL);`)
  }
  read(scope: string, target: string): ReactionState {
    const row = this.db.prepare('SELECT payload FROM local_world_reactions WHERE scope=? AND target=?').get(scope, target) as { payload: string } | undefined
    if (!row) return { revision: 0, selections: [] }
    try {
      const value = JSON.parse(row.payload) as ReactionState
      if (!validRevision(value.revision) || !Array.isArray(value.selections) || value.selections.length > 56) throw new Error('shape')
      const seen = new Set<string>()
      for (const item of value.selections) {
        const key = localReactionKey(item.expression)
        if (item.key !== key || seen.has(key) || !Number.isSafeInteger(item.at) || item.at < 0) throw new Error('selection')
        seen.add(key)
      }
      return value
    } catch { throw new Error('本机表态读取失败，原数据已保留') }
  }
  set(scope: string, target: string, command: { expression: ReactionExpression; active: boolean; expected_revision: number; request_id: string }): ReactionSetResult {
    const expression = localReactionExpression(command.expression), key = localReactionKey(expression)
    if (typeof command.active !== 'boolean' || !validRevision(command.expected_revision) || !/^[A-Za-z0-9._:-]{1,128}$/.test(command.request_id)) throw new Error('表态操作无效')
    const hash = createHash('sha256').update(JSON.stringify({ ...command, expression })).digest('hex')
    let result!: ReactionSetResult
    this.transaction(() => {
      const before = this.read(scope, target)
      if (this.receipt(scope, target, command.request_id, hash)) { result = { outcome: 'idempotent', state: before }; return }
      if (before.revision !== command.expected_revision) { result = { outcome: 'revision_conflict', state: before }; return }
      const existing = before.selections.some(item => item.key === key)
      if (command.active && !existing && before.selections.length >= 56) throw new Error('最多添加56个表态')
      const changed = existing !== command.active
      const selections = changed ? before.selections.filter(item => item.key !== key) : before.selections
      if (changed && command.active) selections.push({ key, expression, at: Date.now() })
      const state = { revision: before.revision + Number(changed), selections }
      this.db.prepare('INSERT INTO local_world_reactions(scope,target,payload) VALUES(?,?,?) ON CONFLICT(scope,target) DO UPDATE SET payload=excluded.payload').run(scope, target, JSON.stringify(state))
      this.saveReceipt(scope, target, command.request_id, hash)
      result = { outcome: changed ? 'updated' : 'unchanged', state }
    })
    return result
  }
  library(scope: string): ReactionLibrary {
    const row = this.db.prepare('SELECT payload FROM local_world_reaction_library WHERE scope=?').get(scope) as { payload: string } | undefined
    if (!row) return { revision: 0, items: [] }
    try {
      const value = JSON.parse(row.payload) as ReactionLibrary
      if (!validRevision(value.revision) || !Array.isArray(value.items) || value.items.length > 58) throw new Error('shape')
      return { revision: value.revision, items: value.items.map(localReactionExpression) }
    } catch { throw new Error('本机短语读取失败，原数据已保留') }
  }
  saveLibrary(scope: string, command: { items: ReactionExpression[]; expected_revision: number; request_id: string }): ReactionLibraryResult {
    if (!Array.isArray(command.items) || command.items.length > 58 || !validRevision(command.expected_revision) || !/^[A-Za-z0-9._:-]{1,128}$/.test(command.request_id)) throw new Error('短语操作无效')
    const items = command.items.map(localReactionExpression)
    if (new Set(items.map(localReactionKey)).size !== items.length) throw new Error('短语重复')
    const hash = createHash('sha256').update(JSON.stringify({ ...command, items })).digest('hex')
    let result!: ReactionLibraryResult
    this.transaction(() => {
      const before = this.library(scope)
      if (this.receipt(scope, 'library', command.request_id, hash)) { result = { outcome: 'idempotent', library: before }; return }
      if (before.revision !== command.expected_revision) { result = { outcome: 'revision_conflict', library: before }; return }
      const library = { revision: before.revision + 1, items }
      this.db.prepare('INSERT INTO local_world_reaction_library(scope,payload) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload').run(scope, JSON.stringify(library))
      this.saveReceipt(scope, 'library', command.request_id, hash)
      result = { outcome: 'updated', library }
    })
    return result
  }
  private receipt(scope: string, target: string, id: string, hash: string) {
    const row = this.db.prepare('SELECT request_hash FROM local_world_reaction_receipts WHERE scope=? AND target=? AND request_id=?').get(scope, target, id) as { request_hash: string } | undefined
    if (row && row.request_hash !== hash) throw new Error('操作内容已变化，请重新选择')
    return !!row
  }
  private saveReceipt(scope: string, target: string, id: string, hash: string) { this.db.prepare('INSERT INTO local_world_reaction_receipts(scope,target,request_id,request_hash) VALUES(?,?,?,?)').run(scope, target, id, hash) }
}
